-- SellerTray merchant push notifications and per-user unread state.
-- Applied to production project on 2026-09-13.

begin;

-- Production already had merchant_notifications when this migration was first
-- applied, but the historical repository did not contain its bootstrap DDL.
-- Keep the repair idempotent: existing production tables are untouched while a
-- clean migration replay gets the base relation required by the push/read model.
create table if not exists public.merchant_notifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  event_key text not null,
  severity text not null default 'info'
    check (severity in ('info','attention','urgent')),
  title text not null,
  body text not null,
  order_id uuid references public.orders(id) on delete cascade,
  change_request_id uuid,
  source_inbound_message_id uuid references public.inbound_messages(id) on delete cascade,
  is_read boolean not null default false,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists merchant_notifications_tenant_created_idx
  on public.merchant_notifications(tenant_id,created_at desc);
create index if not exists merchant_notifications_order_idx
  on public.merchant_notifications(order_id)
  where order_id is not null;
create index if not exists merchant_notifications_source_message_idx
  on public.merchant_notifications(source_inbound_message_id)
  where source_inbound_message_id is not null;

alter table public.merchant_notifications enable row level security;
revoke all on table public.merchant_notifications from public,anon,authenticated;
grant select on table public.merchant_notifications to authenticated;
grant all on table public.merchant_notifications to service_role;

drop policy if exists merchant_notifications_member_read on public.merchant_notifications;
create policy merchant_notifications_member_read
on public.merchant_notifications
for select to authenticated
using (
  exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id=merchant_notifications.tenant_id
      and tm.user_id=(select auth.uid())
  )
);

create table if not exists public.merchant_notification_reads (
  notification_id uuid not null references public.merchant_notifications(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (notification_id, user_id),
  constraint merchant_notification_reads_tenant_user_fk
    foreign key (tenant_id, user_id)
    references public.tenant_members(tenant_id, user_id)
    on delete cascade
);

create index if not exists merchant_notification_reads_user_tenant_idx
  on public.merchant_notification_reads(user_id, tenant_id, read_at desc);

alter table public.merchant_notification_reads enable row level security;
revoke all on table public.merchant_notification_reads from public, anon, authenticated;
grant select, insert, update, delete on table public.merchant_notification_reads to authenticated;
grant all on table public.merchant_notification_reads to service_role;

drop policy if exists merchant_notification_reads_own on public.merchant_notification_reads;
create policy merchant_notification_reads_own
on public.merchant_notification_reads
for all to authenticated
using (user_id=(select auth.uid()))
with check (user_id=(select auth.uid()));

insert into public.merchant_notification_reads(notification_id, tenant_id, user_id, read_at)
select n.id, n.tenant_id, tm.user_id, coalesce(n.read_at, n.updated_at, now())
from public.merchant_notifications n
join public.tenant_members tm on tm.tenant_id=n.tenant_id
where n.is_read=true
on conflict do nothing;

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
    where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id
  ) then
    raise exception 'SellerTray business membership required';
  end if;

  return query
  select n.id,n.event_key,n.severity,n.title,n.body,n.order_id,n.change_request_id,
         n.source_inbound_message_id,
         exists (
           select 1 from public.merchant_notification_reads r
           where r.notification_id=n.id and r.user_id=v_user_id
         ) as is_read,
         n.created_at
  from public.merchant_notifications n
  where n.tenant_id=p_tenant_id
  order by n.created_at desc
  limit greatest(1,least(coalesce(p_limit,50),200));
end;
$$;

revoke all on function public.sellertray_list_merchant_notifications(uuid,integer) from public,anon;
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
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;

  select n.tenant_id into v_tenant_id
  from public.merchant_notifications n
  where n.id=p_notification_id;

  if v_tenant_id is null then raise exception 'Notification not found'; end if;

  if not exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id=v_tenant_id and tm.user_id=v_user_id
  ) then
    raise exception 'SellerTray business membership required';
  end if;

  insert into public.merchant_notification_reads(notification_id,tenant_id,user_id,read_at)
  values (p_notification_id,v_tenant_id,v_user_id,now())
  on conflict (notification_id,user_id)
  do update set read_at=excluded.read_at;
end;
$$;

revoke all on function public.sellertray_mark_merchant_notification_read(uuid) from public,anon;
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
    where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id
  ) then
    raise exception 'SellerTray business membership required';
  end if;

  insert into public.merchant_notification_reads(notification_id,tenant_id,user_id,read_at)
  select n.id,n.tenant_id,v_user_id,now()
  from public.merchant_notifications n
  where n.tenant_id=p_tenant_id
  on conflict (notification_id,user_id)
  do update set read_at=excluded.read_at;
end;
$$;

revoke all on function public.sellertray_mark_all_merchant_notifications_read(uuid) from public,anon;
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
  join public.tenant_members tm on tm.tenant_id=n.tenant_id and tm.user_id=p_user_id
  where not exists (
    select 1 from public.merchant_notification_reads r
    where r.notification_id=n.id and r.user_id=p_user_id
  );
$$;

revoke all on function public.sellertray_unread_notification_count_for_user(uuid)
  from public,anon,authenticated;
grant execute on function public.sellertray_unread_notification_count_for_user(uuid)
  to service_role;

create table if not exists public.merchant_conversation_reads (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  customer_id uuid not null,
  last_read_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id,user_id,customer_id),
  constraint merchant_conversation_reads_member_fk
    foreign key (tenant_id,user_id)
    references public.tenant_members(tenant_id,user_id)
    on delete cascade,
  constraint merchant_conversation_reads_customer_fk
    foreign key (tenant_id,customer_id)
    references public.customers(tenant_id,id)
    on delete cascade
);

create index if not exists merchant_conversation_reads_user_idx
  on public.merchant_conversation_reads(user_id,tenant_id,last_read_at desc);

alter table public.merchant_conversation_reads enable row level security;
revoke all on table public.merchant_conversation_reads from public,anon,authenticated;
grant select,insert,update,delete on table public.merchant_conversation_reads to authenticated;
grant all on table public.merchant_conversation_reads to service_role;

drop policy if exists merchant_conversation_reads_own on public.merchant_conversation_reads;
create policy merchant_conversation_reads_own
on public.merchant_conversation_reads
for all to authenticated
using (user_id=(select auth.uid()))
with check (user_id=(select auth.uid()));

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
    where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id
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
    on r.tenant_id=im.tenant_id
   and r.user_id=v_user_id
   and r.customer_id=im.customer_id
  where im.tenant_id=p_tenant_id
  group by im.customer_id,r.last_read_at;
end;
$$;

revoke all on function public.sellertray_conversation_unread_counts(uuid) from public,anon;
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
    where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id
  ) then
    raise exception 'SellerTray business membership required';
  end if;

  if not exists (
    select 1 from public.customers c
    where c.tenant_id=p_tenant_id and c.id=p_customer_id
  ) then
    raise exception 'Customer not found';
  end if;

  insert into public.merchant_conversation_reads(
    tenant_id,user_id,customer_id,last_read_at,updated_at
  ) values (
    p_tenant_id,v_user_id,p_customer_id,coalesce(p_through,now()),now()
  )
  on conflict (tenant_id,user_id,customer_id)
  do update
  set last_read_at=greatest(public.merchant_conversation_reads.last_read_at,excluded.last_read_at),
      updated_at=now();
end;
$$;

revoke all on function public.sellertray_mark_conversation_read(uuid,uuid,timestamptz)
  from public,anon;
grant execute on function public.sellertray_mark_conversation_read(uuid,uuid,timestamptz)
  to authenticated;

create table if not exists public.merchant_push_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  expo_push_token text not null unique,
  platform text not null,
  device_key text,
  enabled boolean not null default true,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint merchant_push_devices_platform_check check (platform in ('android','ios')),
  constraint merchant_push_devices_token_check check (char_length(expo_push_token) between 20 and 300)
);

create index if not exists merchant_push_devices_user_enabled_idx
  on public.merchant_push_devices(user_id,enabled,last_seen_at desc);

alter table public.merchant_push_devices enable row level security;
revoke all on table public.merchant_push_devices from public,anon,authenticated;
grant select,insert,update,delete on table public.merchant_push_devices to authenticated;
grant all on table public.merchant_push_devices to service_role;

drop policy if exists merchant_push_devices_own on public.merchant_push_devices;
create policy merchant_push_devices_own
on public.merchant_push_devices
for all to authenticated
using (user_id=(select auth.uid()))
with check (user_id=(select auth.uid()));

create table if not exists public.merchant_push_dispatches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  notification_id uuid not null references public.merchant_notifications(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  delivery_status text not null default 'pending',
  attempt_count integer not null default 0,
  available_at timestamptz not null default now(),
  provider_ticket_id text,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (notification_id,user_id),
  constraint merchant_push_dispatches_status_check
    check (delivery_status in ('pending','sending','sent','failed','skipped')),
  constraint merchant_push_dispatches_attempt_check check (attempt_count between 0 and 10)
);

create index if not exists merchant_push_dispatches_claim_idx
  on public.merchant_push_dispatches(delivery_status,available_at,created_at)
  where delivery_status in ('pending','failed');

alter table public.merchant_push_dispatches enable row level security;
revoke all on table public.merchant_push_dispatches from public,anon,authenticated;
grant all on table public.merchant_push_dispatches to service_role;

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
  where tm.tenant_id=new.tenant_id
  on conflict do nothing;
  return new;
end;
$$;

revoke all on function public.queue_sellertray_merchant_push_dispatches()
  from public,anon,authenticated;

drop trigger if exists queue_sellertray_merchant_push_dispatches
  on public.merchant_notifications;
create trigger queue_sellertray_merchant_push_dispatches
after insert on public.merchant_notifications
for each row
execute function public.queue_sellertray_merchant_push_dispatches();

create or replace function public.claim_sellertray_merchant_push_dispatches(
  p_limit integer default 20
)
returns setof public.merchant_push_dispatches
language plpgsql
security definer
set search_path=''
as $$
begin
  update public.merchant_push_dispatches
  set delivery_status='failed',
      last_error=coalesce(last_error,'Push worker lease expired before delivery completed'),
      available_at=now(),
      updated_at=now()
  where delivery_status='sending'
    and updated_at < now()-interval '10 minutes';

  return query
  with candidates as (
    select d.id
    from public.merchant_push_dispatches d
    where d.delivery_status in ('pending','failed')
      and d.attempt_count<3
      and d.available_at<=now()
    order by d.created_at
    for update skip locked
    limit greatest(1,least(coalesce(p_limit,20),50))
  )
  update public.merchant_push_dispatches d
  set delivery_status='sending',
      attempt_count=d.attempt_count+1,
      updated_at=now()
  from candidates c
  where d.id=c.id
  returning d.*;
end;
$$;

revoke all on function public.claim_sellertray_merchant_push_dispatches(integer)
  from public,anon,authenticated;
grant execute on function public.claim_sellertray_merchant_push_dispatches(integer)
  to service_role;

create table if not exists sellertray_private.merchant_push_worker_invocations (
  nonce uuid primary key default gen_random_uuid(),
  expires_at timestamptz not null default (now()+interval '5 minutes'),
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint merchant_push_worker_invocations_expiry_check
    check (expires_at>created_at)
);

revoke all on table sellertray_private.merchant_push_worker_invocations
  from public,anon,authenticated;
grant all on table sellertray_private.merchant_push_worker_invocations
  to service_role;

create or replace function public.claim_sellertray_merchant_push_worker_invocation(
  p_nonce uuid
)
returns boolean
language plpgsql
security definer
set search_path=''
as $$
declare
  v_claimed uuid;
begin
  update sellertray_private.merchant_push_worker_invocations
  set consumed_at=now()
  where nonce=p_nonce and consumed_at is null and expires_at>now()
  returning nonce into v_claimed;
  return v_claimed is not null;
end;
$$;

revoke all on function public.claim_sellertray_merchant_push_worker_invocation(uuid)
  from public,anon,authenticated;
grant execute on function public.claim_sellertray_merchant_push_worker_invocation(uuid)
  to service_role;

create or replace function sellertray_private.kick_merchant_push_worker()
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_url text;
  v_nonce uuid;
begin
  select rc.value into v_url
  from sellertray_private.runtime_config rc
  where rc.key='merchant_push_worker_url';

  if v_url is null then return; end if;

  insert into sellertray_private.merchant_push_worker_invocations default values
  returning nonce into v_nonce;

  perform net.http_post(
    url:=v_url,
    headers:=jsonb_build_object('Content-Type','application/json'),
    body:=jsonb_build_object('invocationNonce',v_nonce),
    timeout_milliseconds:=10000
  );
end;
$$;

revoke all on function sellertray_private.kick_merchant_push_worker()
  from public,anon,authenticated;
grant execute on function sellertray_private.kick_merchant_push_worker()
  to service_role;

create or replace function sellertray_private.kick_merchant_push_worker_trigger()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  perform sellertray_private.kick_merchant_push_worker();
  return new;
end;
$$;

revoke all on function sellertray_private.kick_merchant_push_worker_trigger()
  from public,anon,authenticated;

drop trigger if exists kick_merchant_push_worker_on_queue
  on public.merchant_push_dispatches;
create trigger kick_merchant_push_worker_on_queue
after insert on public.merchant_push_dispatches
for each statement
execute function sellertray_private.kick_merchant_push_worker_trigger();

do $$
begin
  if exists (select 1 from pg_publication where pubname='supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname='supabase_realtime'
         and schemaname='public'
         and tablename='inbound_messages'
     ) then
    execute 'alter publication supabase_realtime add table public.inbound_messages';
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from cron.job where jobname='sellertray-merchant-push-retry'
  ) then
    perform cron.schedule(
      'sellertray-merchant-push-retry',
      '* * * * *',
      'select sellertray_private.kick_merchant_push_worker();'
    );
  end if;
end
$$;

commit;
