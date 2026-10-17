-- SellerTray customer-facing order IDs and WhatsApp self-service.
-- Adds stable public order references, repeatable status/receipt responses, and
-- ensures lifecycle messages carry the customer-facing order ID.

alter table public.orders
  add column if not exists public_order_id text;

create or replace function public.set_sellertray_order_public_id()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.public_order_id is null or btrim(new.public_order_id) = '' then
    new.public_order_id :=
      'ST-' ||
      to_char(coalesce(new.created_at, now()), 'YYMMDD') ||
      '-' ||
      upper(substr(md5(new.id::text), 1, 10));
  end if;
  return new;
end;
$$;

drop trigger if exists set_sellertray_order_public_id on public.orders;
create trigger set_sellertray_order_public_id
before insert on public.orders
for each row
execute function public.set_sellertray_order_public_id();

update public.orders
set public_order_id =
  'ST-' ||
  to_char(coalesce(created_at, now()), 'YYMMDD') ||
  '-' ||
  upper(substr(md5(id::text), 1, 10))
where public_order_id is null or btrim(public_order_id) = '';

alter table public.orders
  alter column public_order_id set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.orders'::regclass
      and conname = 'orders_public_order_id_key'
  ) then
    alter table public.orders
      add constraint orders_public_order_id_key unique (public_order_id);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.orders'::regclass
      and conname = 'orders_public_order_id_format_check'
  ) then
    alter table public.orders
      add constraint orders_public_order_id_format_check
      check (public_order_id ~ '^ST-[0-9]{6}-[A-F0-9]{10}$');
  end if;
end $$;

create or replace function public.guard_sellertray_order_public_id()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.public_order_id is distinct from old.public_order_id then
    raise exception 'SellerTray order ID is immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_sellertray_order_public_id on public.orders;
create trigger guard_sellertray_order_public_id
before update of public_order_id on public.orders
for each row
when (old.public_order_id is distinct from new.public_order_id)
execute function public.guard_sellertray_order_public_id();

alter table public.outbound_notifications
  add column if not exists source_inbound_message_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.outbound_notifications'::regclass
      and conname = 'outbound_notifications_source_message_fkey'
  ) then
    alter table public.outbound_notifications
      add constraint outbound_notifications_source_message_fkey
      foreign key (source_inbound_message_id)
      references public.inbound_messages(id)
      on delete set null;
  end if;
end $$;

alter table public.outbound_notifications
  drop constraint if exists outbound_notifications_order_id_event_key_key;

drop index if exists public.outbound_notifications_lifecycle_unique_idx;
create unique index outbound_notifications_lifecycle_unique_idx
on public.outbound_notifications(order_id, event_key)
where event_key in (
  'order_received',
  'order_accepted',
  'order_ready',
  'order_out_for_delivery',
  'order_rejected',
  'order_cancelled'
);

drop index if exists public.outbound_notifications_query_response_unique_idx;
create unique index outbound_notifications_query_response_unique_idx
on public.outbound_notifications(source_inbound_message_id, event_key)
where source_inbound_message_id is not null
  and event_key in ('order_status_reply', 'order_receipt');

alter table public.outbound_notifications
  drop constraint if exists outbound_notifications_event_key_check;

alter table public.outbound_notifications
  add constraint outbound_notifications_event_key_check
  check (
    event_key = any (
      array[
        'order_received'::text,
        'order_accepted'::text,
        'order_ready'::text,
        'order_out_for_delivery'::text,
        'order_rejected'::text,
        'order_cancelled'::text,
        'order_status_reply'::text,
        'order_receipt'::text
      ]
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
  join public.customers c
    on c.id = new.customer_id
   and c.tenant_id = new.tenant_id
  left join public.tenant_notification_settings s
    on s.tenant_id = new.tenant_id
  where t.id = new.tenant_id;

  if enabled is distinct from true then
    return new;
  end if;

  if phone_number_id is null
     or customer_wa_id is null
     or customer_wa_id like 'manual:%' then
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
    where oi.tenant_id = new.tenant_id
      and oi.order_id = new.id;
  end if;

  body_text := case event_name
    when 'order_received' then format(
      'We received your order at %s. Order ID: %s. Save this ID. You can ask "status %s" or "receipt %s" on WhatsApp at any time.',
      business_name, new.public_order_id, new.public_order_id, new.public_order_id
    )
    when 'order_accepted' then format(
      'Order %s is confirmed with %s. Total: %s %s. We will let you know when it is ready.',
      new.public_order_id, business_name, order_currency, trim(to_char(order_total, 'FM999999999990.00'))
    )
    when 'order_ready' then format(
      'Order %s from %s is ready.',
      new.public_order_id, business_name
    )
    when 'order_rejected' then format(
      'Order %s with %s could not be accepted. Please contact us if you need help.',
      new.public_order_id, business_name
    )
    when 'order_cancelled' then format(
      'Order %s with %s has been cancelled.',
      new.public_order_id, business_name
    )
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
  on conflict do nothing;

  return new;
end;
$$;

revoke all on function public.queue_orderdesk_notification() from public;
revoke all on function public.queue_orderdesk_notification() from anon;
revoke all on function public.queue_orderdesk_notification() from authenticated;

create or replace function public.queue_sellertray_fulfillment_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  enabled boolean := false;
  business_name text;
  phone_number_id text;
  customer_wa_id text;
  last_inbound timestamptz;
  window_expires timestamptz;
  initial_status text;
begin
  if new.fulfillment_status is not distinct from old.fulfillment_status
     or new.fulfillment_status <> 'out_for_delivery' then
    return new;
  end if;

  select
    t.name,
    t.whatsapp_phone_number_id,
    c.wa_id,
    coalesce(s.notify_ready, true)
  into business_name, phone_number_id, customer_wa_id, enabled
  from public.tenants t
  join public.customers c
    on c.id = new.customer_id
   and c.tenant_id = new.tenant_id
  left join public.tenant_notification_settings s
    on s.tenant_id = new.tenant_id
  where t.id = new.tenant_id;

  if enabled is distinct from true
     or phone_number_id is null
     or customer_wa_id is null
     or customer_wa_id like 'manual:%' then
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
    'order_out_for_delivery',
    initial_status,
    phone_number_id,
    customer_wa_id,
    format(
      'Order %s from %s is out for delivery. When it arrives, reply RECEIVED to confirm receipt.',
      new.public_order_id,
      business_name
    ),
    window_expires
  )
  on conflict do nothing;

  return new;
end;
$$;

revoke all on function public.queue_sellertray_fulfillment_notification() from public;
revoke all on function public.queue_sellertray_fulfillment_notification() from anon;
revoke all on function public.queue_sellertray_fulfillment_notification() from authenticated;
