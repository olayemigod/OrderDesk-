-- SellerTray: notify WhatsApp customers when delivery starts and ask for receipt confirmation.

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
        'order_cancelled'::text
      ]
    )
  );

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
      'Your order from %s is out for delivery. When it arrives, reply RECEIVED to confirm receipt.',
      business_name
    ),
    window_expires
  )
  on conflict (order_id, event_key) do nothing;

  return new;
end;
$$;

revoke all on function public.queue_sellertray_fulfillment_notification() from public;
revoke all on function public.queue_sellertray_fulfillment_notification() from anon;
revoke all on function public.queue_sellertray_fulfillment_notification() from authenticated;

drop trigger if exists queue_sellertray_fulfillment_notification_on_status on public.orders;
create trigger queue_sellertray_fulfillment_notification_on_status
after update of fulfillment_status on public.orders
for each row
when (old.fulfillment_status is distinct from new.fulfillment_status)
execute function public.queue_sellertray_fulfillment_notification();
