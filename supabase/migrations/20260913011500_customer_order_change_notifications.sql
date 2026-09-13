-- SellerTray: customer order-change requests, merchant in-app notifications,
-- and durable automatic dispatch of queued WhatsApp notifications.

begin;

create extension if not exists pg_net with schema extensions;

create table public.customer_order_change_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  order_id uuid,
  customer_id uuid not null,
  source_inbound_message_id uuid not null,
  request_kind text not null,
  request_text text not null,
  parsed_items jsonb not null default '[]'::jsonb,
  status text not null default 'pending',
  resolved_by_user_id uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_order_change_requests_source_unique
    unique (tenant_id,source_inbound_message_id),
  constraint customer_order_change_requests_order_same_tenant
    foreign key (tenant_id,order_id)
    references public.orders(tenant_id,id)
    on delete cascade,
  constraint customer_order_change_requests_customer_same_tenant
    foreign key (tenant_id,customer_id)
    references public.customers(tenant_id,id)
    on delete cascade,
  constraint customer_order_change_requests_message_same_tenant
    foreign key (tenant_id,source_inbound_message_id)
    references public.inbound_messages(tenant_id,id)
    on delete cascade,
  constraint customer_order_change_requests_kind_check
    check (request_kind in ('add_items','remove_items','change_items','cancel_order','other')),
  constraint customer_order_change_requests_status_check
    check (status in ('pending','reviewed','resolved','rejected')),
  constraint customer_order_change_requests_text_check
    check (char_length(request_text) between 1 and 2000),
  constraint customer_order_change_requests_items_check
    check (jsonb_typeof(parsed_items)='array'),
  constraint customer_order_change_requests_resolution_check
    check (
      (status='pending' and resolved_at is null)
      or status<>'pending'
    )
);

create index customer_order_change_requests_tenant_status_idx
  on public.customer_order_change_requests(tenant_id,status,created_at desc);
create index customer_order_change_requests_order_idx
  on public.customer_order_change_requests(tenant_id,order_id,created_at desc)
  where order_id is not null;

alter table public.customer_order_change_requests enable row level security;
revoke all on table public.customer_order_change_requests from public,anon,authenticated;
grant select on table public.customer_order_change_requests to authenticated;
grant all on table public.customer_order_change_requests to service_role;

create policy customer_order_change_requests_select_member
on public.customer_order_change_requests
for select to authenticated
using (
  exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id=customer_order_change_requests.tenant_id
      and tm.user_id=(select auth.uid())
  )
);

create table public.merchant_notifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  event_key text not null,
  severity text not null default 'info',
  title text not null,
  body text not null,
  order_id uuid,
  change_request_id uuid,
  source_inbound_message_id uuid,
  is_read boolean not null default false,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint merchant_notifications_order_same_tenant
    foreign key (tenant_id,order_id)
    references public.orders(tenant_id,id)
    on delete cascade,
  constraint merchant_notifications_change_request_same_tenant
    foreign key (tenant_id,change_request_id)
    references public.customer_order_change_requests(tenant_id,id)
    on delete cascade,
  constraint merchant_notifications_message_same_tenant
    foreign key (tenant_id,source_inbound_message_id)
    references public.inbound_messages(tenant_id,id)
    on delete cascade,
  constraint merchant_notifications_event_check
    check (event_key in ('new_whatsapp_order','order_change_request')),
  constraint merchant_notifications_severity_check
    check (severity in ('info','attention','urgent')),
  constraint merchant_notifications_title_check
    check (char_length(title) between 1 and 160),
  constraint merchant_notifications_body_check
    check (char_length(body) between 1 and 1000),
  constraint merchant_notifications_read_check
    check ((is_read=false and read_at is null) or is_read=true)
);

create unique index merchant_notifications_message_event_unique_idx
  on public.merchant_notifications(tenant_id,event_key,source_inbound_message_id)
  where source_inbound_message_id is not null;
create index merchant_notifications_tenant_unread_idx
  on public.merchant_notifications(tenant_id,is_read,created_at desc);
create index merchant_notifications_order_idx
  on public.merchant_notifications(tenant_id,order_id,created_at desc)
  where order_id is not null;

alter table public.merchant_notifications enable row level security;
revoke all on table public.merchant_notifications from public,anon,authenticated;
grant select on table public.merchant_notifications to authenticated;
grant update (is_read,read_at,updated_at) on table public.merchant_notifications to authenticated;
grant all on table public.merchant_notifications to service_role;

create policy merchant_notifications_select_member
on public.merchant_notifications
for select to authenticated
using (
  exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id=merchant_notifications.tenant_id
      and tm.user_id=(select auth.uid())
  )
);

create policy merchant_notifications_update_member
on public.merchant_notifications
for update to authenticated
using (
  exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id=merchant_notifications.tenant_id
      and tm.user_id=(select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id=merchant_notifications.tenant_id
      and tm.user_id=(select auth.uid())
  )
);

do $$
begin
  if exists (select 1 from pg_publication where pubname='supabase_realtime') then
    execute 'alter publication supabase_realtime add table public.merchant_notifications';
  end if;
end
$$;

create or replace function public.queue_sellertray_new_order_merchant_notification()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if new.source='whatsapp' then
    insert into public.merchant_notifications (
      tenant_id,event_key,severity,title,body,order_id,source_inbound_message_id
    ) values (
      new.tenant_id,
      'new_whatsapp_order',
      'attention',
      'New WhatsApp order',
      format('%s needs merchant review.',new.public_order_id),
      new.id,
      new.source_message_id
    )
    on conflict do nothing;
  end if;
  return new;
end;
$$;

revoke all on function public.queue_sellertray_new_order_merchant_notification()
  from public,anon,authenticated;

drop trigger if exists queue_sellertray_new_order_merchant_notification on public.orders;
create trigger queue_sellertray_new_order_merchant_notification
after insert on public.orders
for each row
execute function public.queue_sellertray_new_order_merchant_notification();

create or replace function public.queue_sellertray_order_change_merchant_notification()
returns trigger
language plpgsql
set search_path=''
as $$
declare
  v_ref text;
begin
  select o.public_order_id into v_ref
  from public.orders o
  where o.tenant_id=new.tenant_id and o.id=new.order_id;

  insert into public.merchant_notifications (
    tenant_id,event_key,severity,title,body,order_id,change_request_id,source_inbound_message_id
  ) values (
    new.tenant_id,
    'order_change_request',
    'attention',
    'Customer requested an order change',
    left(
      case
        when v_ref is not null then v_ref || ': ' || new.request_text
        else new.request_text
      end,
      1000
    ),
    new.order_id,
    new.id,
    new.source_inbound_message_id
  )
  on conflict do nothing;

  return new;
end;
$$;

revoke all on function public.queue_sellertray_order_change_merchant_notification()
  from public,anon,authenticated;

drop trigger if exists queue_sellertray_order_change_merchant_notification
  on public.customer_order_change_requests;
create trigger queue_sellertray_order_change_merchant_notification
after insert on public.customer_order_change_requests
for each row
execute function public.queue_sellertray_order_change_merchant_notification();

alter table public.outbound_notifications
  drop constraint if exists outbound_notifications_event_key_check,
  add constraint outbound_notifications_event_key_check
  check (event_key=any(array[
    'order_received'::text,
    'order_accepted'::text,
    'order_ready'::text,
    'order_out_for_delivery'::text,
    'order_rejected'::text,
    'order_cancelled'::text,
    'order_status_reply'::text,
    'order_receipt'::text,
    'order_change_request_received'::text,
    'payment_options'::text,
    'payment_instructions'::text,
    'payment_claim_received'::text,
    'payment_confirmed'::text,
    'payment_status_reply'::text,
    'financial_document'::text
  ]));

create or replace function public.queue_sellertray_order_change_customer_ack()
returns trigger
language plpgsql
set search_path=''
as $$
declare
  v_phone_id text;
  v_wa_id text;
  v_received_at timestamptz;
  v_ref text;
begin
  if new.order_id is null then
    return new;
  end if;

  select t.whatsapp_phone_number_id into v_phone_id
  from public.tenants t where t.id=new.tenant_id;

  select c.wa_id into v_wa_id
  from public.customers c
  where c.tenant_id=new.tenant_id and c.id=new.customer_id;

  select im.received_at into v_received_at
  from public.inbound_messages im
  where im.tenant_id=new.tenant_id and im.id=new.source_inbound_message_id;

  select o.public_order_id into v_ref
  from public.orders o
  where o.tenant_id=new.tenant_id and o.id=new.order_id;

  if v_phone_id is null or v_wa_id is null or v_received_at is null then
    return new;
  end if;

  insert into public.outbound_notifications (
    tenant_id,order_id,customer_id,event_key,delivery_status,
    from_phone_number_id,to_wa_id,message_body,
    conversation_window_expires_at,source_inbound_message_id
  ) values (
    new.tenant_id,
    new.order_id,
    new.customer_id,
    'order_change_request_received',
    'pending',
    v_phone_id,
    v_wa_id,
    format(
      'We received your request to change order %s. The merchant will review it before the order is updated.',
      coalesce(v_ref,'')
    ),
    v_received_at + interval '24 hours',
    new.source_inbound_message_id
  )
  on conflict do nothing;

  return new;
end;
$$;

revoke all on function public.queue_sellertray_order_change_customer_ack()
  from public,anon,authenticated;

drop trigger if exists queue_sellertray_order_change_customer_ack
  on public.customer_order_change_requests;
create trigger queue_sellertray_order_change_customer_ack
after insert on public.customer_order_change_requests
for each row
execute function public.queue_sellertray_order_change_customer_ack();

-- Server-only, single-use invocation tickets let Postgres trigger/schedule the
-- notification Edge Function without exposing a reusable worker token.
create table sellertray_private.notification_worker_invocations (
  nonce uuid primary key default gen_random_uuid(),
  expires_at timestamptz not null default (now()+interval '5 minutes'),
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint notification_worker_invocations_expiry_check
    check (expires_at>created_at)
);

revoke all on table sellertray_private.notification_worker_invocations
  from public,anon,authenticated;
grant all on table sellertray_private.notification_worker_invocations
  to service_role;

create table sellertray_private.runtime_config (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now(),
  constraint runtime_config_key_check check (key ~ '^[a-z0-9_]{1,80}$'),
  constraint runtime_config_value_check check (char_length(value) between 1 and 1000)
);

revoke all on table sellertray_private.runtime_config from public,anon,authenticated;
grant all on table sellertray_private.runtime_config to service_role;

create or replace function public.claim_sellertray_notification_worker_invocation(p_nonce uuid)
returns boolean
language plpgsql
security definer
set search_path=''
as $$
declare
  v_claimed uuid;
begin
  update sellertray_private.notification_worker_invocations
  set consumed_at=now()
  where nonce=p_nonce
    and consumed_at is null
    and expires_at>now()
  returning nonce into v_claimed;

  return v_claimed is not null;
end;
$$;

revoke all on function public.claim_sellertray_notification_worker_invocation(uuid)
  from public,anon,authenticated;
grant execute on function public.claim_sellertray_notification_worker_invocation(uuid)
  to service_role;

create or replace function sellertray_private.kick_whatsapp_notification_worker()
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
  where rc.key='notification_worker_url';

  if v_url is null then
    return;
  end if;

  insert into sellertray_private.notification_worker_invocations default values
  returning nonce into v_nonce;

  perform net.http_post(
    url:=v_url,
    headers:=jsonb_build_object('Content-Type','application/json'),
    body:=jsonb_build_object('invocationNonce',v_nonce),
    timeout_milliseconds:=10000
  );
end;
$$;

revoke all on function sellertray_private.kick_whatsapp_notification_worker()
  from public,anon,authenticated;
grant execute on function sellertray_private.kick_whatsapp_notification_worker()
  to service_role;

create or replace function sellertray_private.kick_whatsapp_notification_worker_trigger()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  perform sellertray_private.kick_whatsapp_notification_worker();
  return new;
end;
$$;

revoke all on function sellertray_private.kick_whatsapp_notification_worker_trigger()
  from public,anon,authenticated;

drop trigger if exists kick_whatsapp_notification_worker_on_queue
  on public.outbound_notifications;
create trigger kick_whatsapp_notification_worker_on_queue
after insert on public.outbound_notifications
for each statement
execute function sellertray_private.kick_whatsapp_notification_worker_trigger();

select cron.schedule(
  'sellertray-whatsapp-notification-retry',
  '* * * * *',
  'select sellertray_private.kick_whatsapp_notification_worker();'
);

commit;
