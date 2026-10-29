begin;

-- Arbitrary-user authority primitives are internal. Authenticated policy
-- evaluation uses current-user wrappers that bind identity to auth.uid().
create or replace function public.sellertray_current_user_can_read_branch(
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
    public.sellertray_user_can_read_branch(
      p_tenant_id,
      p_branch_id,
      (select auth.uid())
    ),
    false
  );
$$;

revoke all on function public.sellertray_current_user_can_read_branch(uuid,uuid)
  from public,anon;
grant execute on function public.sellertray_current_user_can_read_branch(uuid,uuid)
  to authenticated;

create or replace function public.sellertray_current_user_can_access_notification_scope(
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
    public.sellertray_user_can_access_notification_scope(
      p_tenant_id,
      p_branch_id,
      (select auth.uid())
    ),
    false
  );
$$;

revoke all on function public.sellertray_current_user_can_access_notification_scope(uuid,uuid)
  from public,anon;
grant execute on function public.sellertray_current_user_can_access_notification_scope(uuid,uuid)
  to authenticated;

revoke all on function public.sellertray_user_can_read_branch(uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.sellertray_user_can_read_branch(uuid,uuid,uuid)
  to service_role;

revoke all on function public.sellertray_user_can_operate_branch(uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.sellertray_user_can_operate_branch(uuid,uuid,uuid)
  to service_role;

revoke all on function public.sellertray_user_has_capability(uuid,uuid,text)
  from public,anon,authenticated;
grant execute on function public.sellertray_user_has_capability(uuid,uuid,text)
  to service_role;

revoke all on function public.sellertray_user_can_access_notification_scope(uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.sellertray_user_can_access_notification_scope(uuid,uuid,uuid)
  to service_role;

-- Historical order and message reads bind Branch authority to the signed-in user.
drop policy if exists orders_select_member on public.orders;
create policy orders_select_member
on public.orders
for select to authenticated
using (
  public.sellertray_current_user_can_read_branch(
    orders.tenant_id,
    orders.branch_id
  )
);

drop policy if exists order_items_select_member on public.order_items;
create policy order_items_select_member
on public.order_items
for select to authenticated
using (
  exists (
    select 1
    from public.orders o
    where o.tenant_id = order_items.tenant_id
      and o.id = order_items.order_id
      and public.sellertray_current_user_can_read_branch(
        o.tenant_id,
        o.branch_id
      )
  )
);

drop policy if exists order_status_events_select_member on public.order_status_events;
create policy order_status_events_select_member
on public.order_status_events
for select to authenticated
using (
  exists (
    select 1
    from public.orders o
    where o.tenant_id = order_status_events.tenant_id
      and o.id = order_status_events.order_id
      and public.sellertray_current_user_can_read_branch(
        o.tenant_id,
        o.branch_id
      )
  )
);

drop policy if exists outbound_notifications_select_member on public.outbound_notifications;
create policy outbound_notifications_select_member
on public.outbound_notifications
for select to authenticated
using (
  exists (
    select 1
    from public.orders o
    where o.tenant_id = outbound_notifications.tenant_id
      and o.id = outbound_notifications.order_id
      and public.sellertray_current_user_can_read_branch(
        o.tenant_id,
        o.branch_id
      )
  )
);

drop policy if exists order_financial_documents_select_member on public.order_financial_documents;
create policy order_financial_documents_select_member
on public.order_financial_documents
for select to authenticated
using (
  exists (
    select 1
    from public.orders o
    where o.tenant_id = order_financial_documents.tenant_id
      and o.id = order_financial_documents.order_id
      and public.sellertray_current_user_can_read_branch(
        o.tenant_id,
        o.branch_id
      )
  )
);

drop policy if exists order_payments_select_member on public.order_payments;
create policy order_payments_select_member
on public.order_payments
for select to authenticated
using (
  exists (
    select 1
    from public.orders o
    where o.tenant_id = order_payments.tenant_id
      and o.id = order_payments.order_id
      and public.sellertray_current_user_can_read_branch(
        o.tenant_id,
        o.branch_id
      )
  )
);

drop policy if exists inbound_messages_select_member on public.inbound_messages;
create policy inbound_messages_select_member
on public.inbound_messages
for select to authenticated
using (
  public.sellertray_current_user_can_read_branch(
    inbound_messages.tenant_id,
    inbound_messages.branch_id
  )
);

drop policy if exists merchant_conversation_reads_own on public.merchant_conversation_reads;
create policy merchant_conversation_reads_own
on public.merchant_conversation_reads
for all to authenticated
using (
  user_id = (select auth.uid())
  and public.sellertray_current_user_can_read_branch(
    tenant_id,
    branch_id
  )
)
with check (
  user_id = (select auth.uid())
  and public.sellertray_current_user_can_read_branch(
    tenant_id,
    branch_id
  )
);

-- Notification RLS likewise binds visibility to the signed-in user. Internal
-- delivery and list commands may still evaluate explicit users as definer code.
drop policy if exists merchant_notifications_select_member on public.merchant_notifications;
create policy merchant_notifications_select_member
on public.merchant_notifications
for select to authenticated
using (
  public.sellertray_current_user_can_access_notification_scope(
    merchant_notifications.tenant_id,
    merchant_notifications.branch_id
  )
);

drop policy if exists merchant_notifications_update_member on public.merchant_notifications;
create policy merchant_notifications_update_member
on public.merchant_notifications
for update to authenticated
using (
  public.sellertray_current_user_can_access_notification_scope(
    merchant_notifications.tenant_id,
    merchant_notifications.branch_id
  )
)
with check (
  public.sellertray_current_user_can_access_notification_scope(
    merchant_notifications.tenant_id,
    merchant_notifications.branch_id
  )
);

drop policy if exists merchant_notification_reads_own on public.merchant_notification_reads;
create policy merchant_notification_reads_own
on public.merchant_notification_reads
for all to authenticated
using (
  user_id = (select auth.uid())
  and exists (
    select 1
    from public.merchant_notifications n
    where n.id = merchant_notification_reads.notification_id
      and n.tenant_id = merchant_notification_reads.tenant_id
      and public.sellertray_current_user_can_access_notification_scope(
        n.tenant_id,
        n.branch_id
      )
  )
)
with check (
  user_id = (select auth.uid())
  and exists (
    select 1
    from public.merchant_notifications n
    where n.id = merchant_notification_reads.notification_id
      and n.tenant_id = merchant_notification_reads.tenant_id
      and public.sellertray_current_user_can_access_notification_scope(
        n.tenant_id,
        n.branch_id
      )
  )
);

-- This read model is SECURITY INVOKER, so it must use the authenticated-safe
-- wrapper rather than the arbitrary-user helper.
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
set search_path=''
as $$
  with branch_access as (
    select 1
    where current_user='postgres'
       or (select auth.role())='service_role'
       or public.sellertray_current_user_can_read_branch(
         p_tenant_id,
         p_branch_id
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
    on ci.tenant_id=im.tenant_id
   and ci.id=im.catalog_item_id
  where im.tenant_id=p_tenant_id
    and im.branch_id=p_branch_id
    and (p_catalog_item_id is null or im.catalog_item_id=p_catalog_item_id)
  order by im.business_at desc,im.created_at desc
  limit greatest(1,least(coalesce(p_limit,100),500));
$$;

revoke all on function public.get_sellertray_stock_movements(uuid,uuid,uuid,integer)
  from public,anon;
grant execute on function public.get_sellertray_stock_movements(uuid,uuid,uuid,integer)
  to authenticated,service_role;

commit;
