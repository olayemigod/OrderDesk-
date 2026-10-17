create table if not exists public.tenant_notification_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  notify_received boolean not null default true,
  notify_accepted boolean not null default true,
  notify_ready boolean not null default true,
  notify_rejected boolean not null default true,
  notify_cancelled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.tenant_notification_settings (tenant_id)
select t.id from public.tenants t
on conflict (tenant_id) do nothing;

create or replace function public.ensure_orderdesk_notification_settings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.tenant_notification_settings (tenant_id)
  values (new.id)
  on conflict (tenant_id) do nothing;
  return new;
end;
$$;

revoke all on function public.ensure_orderdesk_notification_settings() from public;
revoke all on function public.ensure_orderdesk_notification_settings() from anon;
revoke all on function public.ensure_orderdesk_notification_settings() from authenticated;

drop trigger if exists ensure_orderdesk_notification_settings on public.tenants;
create trigger ensure_orderdesk_notification_settings
after insert on public.tenants
for each row
execute function public.ensure_orderdesk_notification_settings();

alter table public.tenant_notification_settings enable row level security;
revoke all on table public.tenant_notification_settings from anon, authenticated;
grant select on table public.tenant_notification_settings to authenticated;
grant update (
  notify_received,
  notify_accepted,
  notify_ready,
  notify_rejected,
  notify_cancelled,
  updated_at
) on table public.tenant_notification_settings to authenticated;

create policy tenant_notification_settings_select_member
on public.tenant_notification_settings
for select
to authenticated
using (
  exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = tenant_notification_settings.tenant_id
      and tm.user_id = (select auth.uid())
  )
);

create policy tenant_notification_settings_update_owner_manager
on public.tenant_notification_settings
for update
to authenticated
using (
  exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = tenant_notification_settings.tenant_id
      and tm.user_id = (select auth.uid())
      and tm.role in ('owner', 'manager')
  )
)
with check (
  exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = tenant_notification_settings.tenant_id
      and tm.user_id = (select auth.uid())
      and tm.role in ('owner', 'manager')
  )
);

create table if not exists public.outbound_notifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  order_id uuid not null,
  customer_id uuid not null,
  channel text not null default 'whatsapp' check (channel = 'whatsapp'),
  event_key text not null check (
    event_key in ('order_received', 'order_accepted', 'order_ready', 'order_rejected', 'order_cancelled')
  ),
  delivery_status text not null default 'pending' check (
    delivery_status in ('pending', 'sending', 'sent', 'failed', 'template_required', 'skipped')
  ),
  from_phone_number_id text not null,
  to_wa_id text not null,
  message_body text not null check (char_length(message_body) between 1 and 2000),
  conversation_window_expires_at timestamptz,
  provider_message_id text,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error text,
  available_at timestamptz not null default now(),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, event_key),
  constraint outbound_notifications_order_same_tenant
    foreign key (tenant_id, order_id)
    references public.orders(tenant_id, id)
    on delete cascade,
  constraint outbound_notifications_customer_same_tenant
    foreign key (tenant_id, customer_id)
    references public.customers(tenant_id, id)
    on delete cascade
);

create index if not exists outbound_notifications_tenant_order_idx
  on public.outbound_notifications (tenant_id, order_id, created_at desc);
create index if not exists outbound_notifications_delivery_queue_idx
  on public.outbound_notifications (delivery_status, available_at, created_at)
  where delivery_status in ('pending', 'failed');

alter table public.outbound_notifications enable row level security;
revoke all on table public.outbound_notifications from anon, authenticated;
grant select on table public.outbound_notifications to authenticated;

create policy outbound_notifications_select_member
on public.outbound_notifications
for select
to authenticated
using (
  exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = outbound_notifications.tenant_id
      and tm.user_id = (select auth.uid())
  )
);

create or replace function public.queue_orderdesk_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_name text;
  enabled boolean := false;
  business_name text;
  phone_number_id text;
  customer_wa_id text;
  last_inbound timestamptz;
  window_expires timestamptz;
  initial_status text;
  body_text text;
  order_total numeric(14,2);
  order_currency text;
begin
  if tg_op = 'INSERT' then
    if new.source <> 'whatsapp' then
      return new;
    end if;
    event_name := 'order_received';
  elsif new.status is distinct from old.status then
    event_name := case new.status
      when 'accepted' then 'order_accepted'
      when 'ready' then 'order_ready'
      when 'rejected' then 'order_rejected'
      when 'cancelled' then 'order_cancelled'
      else null
    end;
  end if;

  if event_name is null then
    return new;
  end if;

  select
    t.name,
    t.whatsapp_phone_number_id,
    c.wa_id,
    case event_name
      when 'order_received' then coalesce(s.notify_received, true)
      when 'order_accepted' then coalesce(s.notify_accepted, true)
      when 'order_ready' then coalesce(s.notify_ready, true)
      when 'order_rejected' then coalesce(s.notify_rejected, true)
      when 'order_cancelled' then coalesce(s.notify_cancelled, true)
      else false
    end
  into business_name, phone_number_id, customer_wa_id, enabled
  from public.tenants t
  join public.customers c on c.id = new.customer_id and c.tenant_id = new.tenant_id
  left join public.tenant_notification_settings s on s.tenant_id = new.tenant_id
  where t.id = new.tenant_id;

  if enabled is distinct from true then
    return new;
  end if;

  if phone_number_id is null or customer_wa_id is null then
    return new;
  end if;

  select max(im.received_at)
  into last_inbound
  from public.inbound_messages im
  where im.tenant_id = new.tenant_id
    and im.customer_id = new.customer_id;

  if last_inbound is not null then
    window_expires := last_inbound + interval '24 hours';
  end if;

  initial_status := case
    when window_expires is null or window_expires <= now() then 'template_required'
    else 'pending'
  end;

  order_currency := coalesce(new.currency, 'NGN');

  if event_name = 'order_accepted' then
    select coalesce(sum(oi.line_total), 0)
    into order_total
    from public.order_items oi
    where oi.tenant_id = new.tenant_id and oi.order_id = new.id;
  end if;

  body_text := case event_name
    when 'order_received' then format('We received your order at %s. We are reviewing it and will confirm shortly.', business_name)
    when 'order_accepted' then format('Your order with %s is confirmed. Total: %s %s. We will let you know when it is ready.', business_name, order_currency, trim(to_char(order_total, 'FM999999999990.00')))
    when 'order_ready' then format('Your order from %s is ready.', business_name)
    when 'order_rejected' then format('Your order with %s could not be accepted. Please contact us if you need help.', business_name)
    when 'order_cancelled' then format('Your order with %s has been cancelled.', business_name)
    else null
  end;

  insert into public.outbound_notifications (
    tenant_id,
    order_id,
    customer_id,
    event_key,
    delivery_status,
    from_phone_number_id,
    to_wa_id,
    message_body,
    conversation_window_expires_at
  ) values (
    new.tenant_id,
    new.id,
    new.customer_id,
    event_name,
    initial_status,
    phone_number_id,
    customer_wa_id,
    body_text,
    window_expires
  )
  on conflict (order_id, event_key) do nothing;

  return new;
end;
$$;

revoke all on function public.queue_orderdesk_notification() from public;
revoke all on function public.queue_orderdesk_notification() from anon;
revoke all on function public.queue_orderdesk_notification() from authenticated;

drop trigger if exists queue_orderdesk_notification_on_create on public.orders;
create trigger queue_orderdesk_notification_on_create
after insert on public.orders
for each row
execute function public.queue_orderdesk_notification();

drop trigger if exists queue_orderdesk_notification_on_status on public.orders;
create trigger queue_orderdesk_notification_on_status
after update of status on public.orders
for each row
when (old.status is distinct from new.status)
execute function public.queue_orderdesk_notification();

create or replace function public.claim_outbound_notifications(p_limit integer default 20)
returns setof public.outbound_notifications
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.outbound_notifications
  set delivery_status = 'template_required',
      updated_at = now()
  where delivery_status in ('pending', 'failed')
    and conversation_window_expires_at is not null
    and conversation_window_expires_at <= now();

  return query
  with candidates as (
    select n.id
    from public.outbound_notifications n
    where n.delivery_status in ('pending', 'failed')
      and n.attempt_count < 3
      and n.available_at <= now()
      and n.conversation_window_expires_at is not null
      and n.conversation_window_expires_at > now()
    order by n.created_at
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 20), 50))
  )
  update public.outbound_notifications n
  set delivery_status = 'sending',
      attempt_count = n.attempt_count + 1,
      updated_at = now()
  from candidates c
  where n.id = c.id
  returning n.*;
end;
$$;

revoke all on function public.claim_outbound_notifications(integer) from public;
revoke all on function public.claim_outbound_notifications(integer) from anon;
revoke all on function public.claim_outbound_notifications(integer) from authenticated;
grant execute on function public.claim_outbound_notifications(integer) to service_role;
