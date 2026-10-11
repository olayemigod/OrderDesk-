begin;

-- Operational merchant notifications follow the Branch of their parent order or
-- inbound WhatsApp message. A null Branch is reserved for genuinely business-wide
-- notifications and is visible only to business management.
alter table public.merchant_notifications
  add column if not exists branch_id uuid;

update public.merchant_notifications n
set branch_id = o.branch_id
from public.orders o
where n.branch_id is null
  and n.order_id is not null
  and o.tenant_id = n.tenant_id
  and o.id = n.order_id;

update public.merchant_notifications n
set branch_id = im.branch_id
from public.inbound_messages im
where n.branch_id is null
  and n.source_inbound_message_id is not null
  and im.tenant_id = n.tenant_id
  and im.id = n.source_inbound_message_id;

update public.merchant_notifications n
set branch_id = coalesce(o.branch_id, im.branch_id)
from public.customer_order_change_requests cr
left join public.orders o
  on o.tenant_id = cr.tenant_id
 and o.id = cr.order_id
left join public.inbound_messages im
  on im.tenant_id = cr.tenant_id
 and im.id = cr.source_inbound_message_id
where n.branch_id is null
  and n.change_request_id is not null
  and cr.tenant_id = n.tenant_id
  and cr.id = n.change_request_id;

alter table public.merchant_notifications
  add constraint merchant_notifications_branch_same_tenant
    foreign key (tenant_id,branch_id)
    references public.branches(tenant_id,id)
    on delete restrict;

create index if not exists merchant_notifications_tenant_branch_created_idx
  on public.merchant_notifications(tenant_id,branch_id,created_at desc);

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

revoke all on function public.sellertray_user_can_access_notification_scope(uuid,uuid,uuid)
  from public,anon;
grant execute on function public.sellertray_user_can_access_notification_scope(uuid,uuid,uuid)
  to authenticated,service_role;

create or replace function public.apply_sellertray_merchant_notification_branch()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_source_branch_id uuid;
begin
  if tg_op = 'UPDATE' and new.branch_id is distinct from old.branch_id then
    raise exception 'Notification Branch is immutable' using errcode='23514';
  end if;

  if new.order_id is not null then
    select o.branch_id into v_source_branch_id
    from public.orders o
    where o.tenant_id = new.tenant_id
      and o.id = new.order_id;
  end if;

  if v_source_branch_id is null and new.source_inbound_message_id is not null then
    select im.branch_id into v_source_branch_id
    from public.inbound_messages im
    where im.tenant_id = new.tenant_id
      and im.id = new.source_inbound_message_id;
  end if;

  if v_source_branch_id is null and new.change_request_id is not null then
    select coalesce(o.branch_id, im.branch_id)
      into v_source_branch_id
    from public.customer_order_change_requests cr
    left join public.orders o
      on o.tenant_id = cr.tenant_id
     and o.id = cr.order_id
    left join public.inbound_messages im
      on im.tenant_id = cr.tenant_id
     and im.id = cr.source_inbound_message_id
    where cr.tenant_id = new.tenant_id
      and cr.id = new.change_request_id;
  end if;

  if v_source_branch_id is not null then
    if new.branch_id is null then
      new.branch_id := v_source_branch_id;
    elsif new.branch_id <> v_source_branch_id then
      raise exception 'Notification Branch must match its source commerce record'
        using errcode='23514';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.apply_sellertray_merchant_notification_branch()
  from public,anon,authenticated;

drop trigger if exists apply_sellertray_merchant_notification_branch
  on public.merchant_notifications;
create trigger apply_sellertray_merchant_notification_branch
before insert or update of tenant_id,branch_id,order_id,change_request_id,source_inbound_message_id
on public.merchant_notifications
for each row execute function public.apply_sellertray_merchant_notification_branch();

-- Direct notification reads and the legacy read-marker update surface follow the
-- same Branch scope. Business-wide notifications are management-only.
drop policy if exists merchant_notifications_select_member on public.merchant_notifications;
create policy merchant_notifications_select_member
on public.merchant_notifications
for select to authenticated
using (
  public.sellertray_user_can_access_notification_scope(
    merchant_notifications.tenant_id,
    merchant_notifications.branch_id,
    (select auth.uid())
  )
);

drop policy if exists merchant_notifications_update_member on public.merchant_notifications;
create policy merchant_notifications_update_member
on public.merchant_notifications
for update to authenticated
using (
  public.sellertray_user_can_access_notification_scope(
    merchant_notifications.tenant_id,
    merchant_notifications.branch_id,
    (select auth.uid())
  )
)
with check (
  public.sellertray_user_can_access_notification_scope(
    merchant_notifications.tenant_id,
    merchant_notifications.branch_id,
    (select auth.uid())
  )
);

-- Per-user read rows may only reference notifications visible to that user.
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
      and public.sellertray_user_can_access_notification_scope(
        n.tenant_id,
        n.branch_id,
        (select auth.uid())
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
      and public.sellertray_user_can_access_notification_scope(
        n.tenant_id,
        n.branch_id,
        (select auth.uid())
      )
  )
);

create or replace function public.sellertray_list_merchant_notifications(
  p_tenant_id uuid,
  p_limit integer default 50
)
returns table (
  id uuid,
  event_key text,
  severity text,
  title text,
  body text,
  order_id uuid,
  change_request_id uuid,
  source_inbound_message_id uuid,
  is_read boolean,
  created_at timestamptz
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
  select n.id,n.event_key,n.severity,n.title,n.body,n.order_id,n.change_request_id,
         n.source_inbound_message_id,
         exists (
           select 1 from public.merchant_notification_reads r
           where r.notification_id = n.id
             and r.user_id = v_user_id
         ) as is_read,
         n.created_at
  from public.merchant_notifications n
  where n.tenant_id = p_tenant_id
    and public.sellertray_user_can_access_notification_scope(
      n.tenant_id,
      n.branch_id,
      v_user_id
    )
  order by n.created_at desc
  limit greatest(1,least(coalesce(p_limit,50),200));
end;
$$;

revoke all on function public.sellertray_list_merchant_notifications(uuid,integer)
  from public,anon;
grant execute on function public.sellertray_list_merchant_notifications(uuid,integer)
  to authenticated,service_role;

create or replace function public.sellertray_mark_merchant_notification_read(
  p_notification_id uuid
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user_id uuid := auth.uid();
  v_tenant_id uuid;
  v_branch_id uuid;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;

  select n.tenant_id,n.branch_id
    into v_tenant_id,v_branch_id
  from public.merchant_notifications n
  where n.id = p_notification_id;

  if v_tenant_id is null then raise exception 'Notification not found'; end if;

  if not public.sellertray_user_can_access_notification_scope(
    v_tenant_id,
    v_branch_id,
    v_user_id
  ) then
    raise exception 'SellerTray notification access required' using errcode='42501';
  end if;

  insert into public.merchant_notification_reads(notification_id,tenant_id,user_id,read_at)
  values (p_notification_id,v_tenant_id,v_user_id,now())
  on conflict (notification_id,user_id)
  do update set read_at=excluded.read_at;
end;
$$;

revoke all on function public.sellertray_mark_merchant_notification_read(uuid)
  from public,anon;
grant execute on function public.sellertray_mark_merchant_notification_read(uuid)
  to authenticated;

create or replace function public.sellertray_mark_all_merchant_notifications_read(
  p_tenant_id uuid
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

  insert into public.merchant_notification_reads(notification_id,tenant_id,user_id,read_at)
  select n.id,n.tenant_id,v_user_id,now()
  from public.merchant_notifications n
  where n.tenant_id = p_tenant_id
    and public.sellertray_user_can_access_notification_scope(
      n.tenant_id,
      n.branch_id,
      v_user_id
    )
  on conflict (notification_id,user_id)
  do update set read_at=excluded.read_at;
end;
$$;

revoke all on function public.sellertray_mark_all_merchant_notifications_read(uuid)
  from public,anon;
grant execute on function public.sellertray_mark_all_merchant_notifications_read(uuid)
  to authenticated;

create or replace function public.sellertray_unread_notification_count_for_user(
  p_user_id uuid
)
returns integer
language sql
security definer
set search_path=''
as $$
  select count(*)::integer
  from public.merchant_notifications n
  join public.tenant_members tm
    on tm.tenant_id = n.tenant_id
   and tm.user_id = p_user_id
  where public.sellertray_user_can_access_notification_scope(
          n.tenant_id,
          n.branch_id,
          p_user_id
        )
    and not exists (
      select 1
      from public.merchant_notification_reads r
      where r.notification_id = n.id
        and r.user_id = p_user_id
    );
$$;

revoke all on function public.sellertray_unread_notification_count_for_user(uuid)
  from public,anon,authenticated;
grant execute on function public.sellertray_unread_notification_count_for_user(uuid)
  to service_role;

-- Push delivery follows the same Branch boundary. Owners/managers retain access
-- to every active Branch; Staff receive only notifications for Branches they can
-- operate. Business-wide notifications are sent only to management.
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
    and public.sellertray_user_can_access_notification_scope(
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
