begin;

-- Operational access and historical read access are deliberately different.
-- sellertray_user_can_access_branch remains the authority for new commerce and
-- mutations and therefore still requires an active Branch. This helper allows
-- current authorized users to retain appropriate read/audit access after a
-- Branch is deactivated without making that Branch operational again.
create or replace function public.sellertray_user_can_read_branch(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select exists (
    select 1
    from public.tenant_members tm
    join public.branches b
      on b.tenant_id = tm.tenant_id
     and b.id = p_branch_id
    where tm.tenant_id = p_tenant_id
      and tm.user_id = p_user_id
      and (
        tm.role in ('owner','manager')
        or exists (
          select 1
          from public.branch_user_access bua
          where bua.tenant_id = p_tenant_id
            and bua.branch_id = p_branch_id
            and bua.user_id = p_user_id
            and bua.can_operate = true
        )
        or (
          tm.role = 'staff'
          and b.is_default = true
          and not exists (
            select 1
            from public.branch_user_access any_bua
            where any_bua.tenant_id = p_tenant_id
              and any_bua.user_id = p_user_id
          )
        )
      )
  );
$$;

revoke all on function public.sellertray_user_can_read_branch(uuid,uuid,uuid)
  from public,anon;
grant execute on function public.sellertray_user_can_read_branch(uuid,uuid,uuid)
  to authenticated,service_role;

-- Historical order reads survive Branch deactivation. Mutating policies are not
-- changed and continue to use sellertray_user_can_access_branch.
drop policy if exists orders_select_member on public.orders;
create policy orders_select_member
on public.orders
for select to authenticated
using (
  public.sellertray_user_can_read_branch(
    orders.tenant_id,
    orders.branch_id,
    (select auth.uid())
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
      and public.sellertray_user_can_read_branch(
        o.tenant_id,
        o.branch_id,
        (select auth.uid())
      )
  )
);

-- Server-managed order evidence follows historical parent-order visibility.
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
      and public.sellertray_user_can_read_branch(
        o.tenant_id,
        o.branch_id,
        (select auth.uid())
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
      and public.sellertray_user_can_read_branch(
        o.tenant_id,
        o.branch_id,
        (select auth.uid())
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
      and public.sellertray_user_can_read_branch(
        o.tenant_id,
        o.branch_id,
        (select auth.uid())
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
      and public.sellertray_user_can_read_branch(
        o.tenant_id,
        o.branch_id,
        (select auth.uid())
      )
  )
);

-- WhatsApp history is historical evidence. Inbound creation/routing continues to
-- require an active receiving Branch through its existing trigger.
drop policy if exists inbound_messages_select_member on public.inbound_messages;
create policy inbound_messages_select_member
on public.inbound_messages
for select to authenticated
using (
  public.sellertray_user_can_read_branch(
    inbound_messages.tenant_id,
    inbound_messages.branch_id,
    (select auth.uid())
  )
);

-- Conversation cursors are read-state only, so users may maintain them while
-- reviewing historical chats from a Branch they can still read.
drop policy if exists merchant_conversation_reads_own on public.merchant_conversation_reads;
create policy merchant_conversation_reads_own
on public.merchant_conversation_reads
for all to authenticated
using (
  user_id = (select auth.uid())
  and public.sellertray_user_can_read_branch(
    tenant_id,
    branch_id,
    (select auth.uid())
  )
)
with check (
  user_id = (select auth.uid())
  and public.sellertray_user_can_read_branch(
    tenant_id,
    branch_id,
    (select auth.uid())
  )
);

create or replace function public.sellertray_conversation_unread_counts(
  p_tenant_id uuid,
  p_branch_id uuid
)
returns table (
  customer_id uuid,
  unread_count bigint,
  latest_received_at timestamptz
)
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if not public.sellertray_user_can_read_branch(p_tenant_id,p_branch_id,v_user_id) then
    raise exception 'SellerTray Branch read access required' using errcode='42501';
  end if;

  return query
  select im.customer_id,
         count(*) filter (
           where im.received_at > coalesce(r.last_read_at,'epoch'::timestamptz)
         ) as unread_count,
         max(im.received_at) as latest_received_at
  from public.inbound_messages im
  left join public.merchant_conversation_reads r
    on r.tenant_id = im.tenant_id
   and r.user_id = v_user_id
   and r.branch_id = im.branch_id
   and r.customer_id = im.customer_id
  where im.tenant_id = p_tenant_id
    and im.branch_id = p_branch_id
  group by im.customer_id,r.last_read_at;
end;
$$;

revoke all on function public.sellertray_conversation_unread_counts(uuid,uuid)
  from public,anon;
grant execute on function public.sellertray_conversation_unread_counts(uuid,uuid)
  to authenticated,service_role;

create or replace function public.sellertray_mark_conversation_read(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_customer_id uuid,
  p_through timestamptz default now()
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if not public.sellertray_user_can_read_branch(p_tenant_id,p_branch_id,v_user_id) then
    raise exception 'SellerTray Branch read access required' using errcode='42501';
  end if;

  if not exists (
    select 1 from public.customers c
    where c.tenant_id = p_tenant_id
      and c.id = p_customer_id
  ) then
    raise exception 'Customer not found';
  end if;

  insert into public.merchant_conversation_reads(
    tenant_id,user_id,branch_id,customer_id,last_read_at,updated_at
  ) values (
    p_tenant_id,v_user_id,p_branch_id,p_customer_id,coalesce(p_through,now()),now()
  )
  on conflict (tenant_id,user_id,branch_id,customer_id)
  do update
  set last_read_at = greatest(
        public.merchant_conversation_reads.last_read_at,
        excluded.last_read_at
      ),
      updated_at = now();
end;
$$;

revoke all on function public.sellertray_mark_conversation_read(uuid,uuid,uuid,timestamptz)
  from public,anon;
grant execute on function public.sellertray_mark_conversation_read(uuid,uuid,uuid,timestamptz)
  to authenticated;

-- Legacy tenant-wide read-state APIs retain access to historical Branches the
-- current user is still authorized to read.
create or replace function public.sellertray_conversation_unread_counts(
  p_tenant_id uuid
)
returns table (
  customer_id uuid,
  unread_count bigint,
  latest_received_at timestamptz
)
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = p_tenant_id
      and tm.user_id = v_user_id
  ) then
    raise exception 'SellerTray business membership required';
  end if;

  return query
  select im.customer_id,
         count(*) filter (
           where im.received_at > coalesce(r.last_read_at,'epoch'::timestamptz)
         ) as unread_count,
         max(im.received_at) as latest_received_at
  from public.inbound_messages im
  left join public.merchant_conversation_reads r
    on r.tenant_id = im.tenant_id
   and r.user_id = v_user_id
   and r.branch_id = im.branch_id
   and r.customer_id = im.customer_id
  where im.tenant_id = p_tenant_id
    and public.sellertray_user_can_read_branch(
      im.tenant_id,
      im.branch_id,
      v_user_id
    )
  group by im.customer_id;
end;
$$;

revoke all on function public.sellertray_conversation_unread_counts(uuid)
  from public,anon;
grant execute on function public.sellertray_conversation_unread_counts(uuid)
  to authenticated,service_role;

create or replace function public.sellertray_mark_conversation_read(
  p_tenant_id uuid,
  p_customer_id uuid,
  p_through timestamptz default now()
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = p_tenant_id
      and tm.user_id = v_user_id
  ) then
    raise exception 'SellerTray business membership required';
  end if;

  if not exists (
    select 1 from public.customers c
    where c.tenant_id = p_tenant_id
      and c.id = p_customer_id
  ) then
    raise exception 'Customer not found';
  end if;

  insert into public.merchant_conversation_reads(
    tenant_id,user_id,branch_id,customer_id,last_read_at,updated_at
  )
  select distinct
    im.tenant_id,
    v_user_id,
    im.branch_id,
    im.customer_id,
    coalesce(p_through,now()),
    now()
  from public.inbound_messages im
  where im.tenant_id = p_tenant_id
    and im.customer_id = p_customer_id
    and public.sellertray_user_can_read_branch(
      im.tenant_id,
      im.branch_id,
      v_user_id
    )
  on conflict (tenant_id,user_id,branch_id,customer_id)
  do update
  set last_read_at = greatest(
        public.merchant_conversation_reads.last_read_at,
        excluded.last_read_at
      ),
      updated_at = now();
end;
$$;

revoke all on function public.sellertray_mark_conversation_read(uuid,uuid,timestamptz)
  from public,anon;
grant execute on function public.sellertray_mark_conversation_read(uuid,uuid,timestamptz)
  to authenticated;

-- Notification visibility is historical/read-oriented and therefore uses the
-- historical helper. Business-wide notifications remain management-only.
create or replace function public.sellertray_user_can_access_notification_scope(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = p_tenant_id
      and tm.user_id = p_user_id
      and (
        (
          p_branch_id is not null
          and public.sellertray_user_can_read_branch(
            p_tenant_id,
            p_branch_id,
            p_user_id
          )
        )
        or (
          p_branch_id is null
          and tm.role in ('owner','manager')
        )
      )
  );
$$;

revoke all on function public.sellertray_user_can_access_notification_scope(uuid,uuid,uuid)
  from public,anon;
grant execute on function public.sellertray_user_can_access_notification_scope(uuid,uuid,uuid)
  to authenticated,service_role;

-- Push is an operational delivery channel, not historical access. Keep it tied
-- to active Branch operation so deactivated Branches do not generate Staff push.
create or replace function public.sellertray_user_can_receive_notification_scope(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = p_tenant_id
      and tm.user_id = p_user_id
      and (
        (
          p_branch_id is not null
          and public.sellertray_user_can_access_branch(
            p_tenant_id,
            p_branch_id,
            p_user_id
          )
        )
        or (
          p_branch_id is null
          and tm.role in ('owner','manager')
        )
      )
  );
$$;

revoke all on function public.sellertray_user_can_receive_notification_scope(uuid,uuid,uuid)
  from public,anon;
grant execute on function public.sellertray_user_can_receive_notification_scope(uuid,uuid,uuid)
  to service_role;

create or replace function public.queue_sellertray_merchant_push_dispatches()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  insert into public.merchant_push_dispatches(tenant_id,notification_id,user_id)
  select new.tenant_id,new.id,tm.user_id
  from public.tenant_members tm
  where tm.tenant_id = new.tenant_id
    and public.sellertray_user_can_receive_notification_scope(
      new.tenant_id,
      new.branch_id,
      tm.user_id
    )
  on conflict do nothing;
  return new;
end;
$$;

revoke all on function public.queue_sellertray_merchant_push_dispatches()
  from public,anon,authenticated;

commit;
