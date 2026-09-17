-- SellerTray P0: include useful dispatch details in the WhatsApp customer update.
-- Optional operational fields are shown only when captured; receipt confirmation
-- remains the final customer action.

begin;

create or replace function public.queue_sellertray_fulfillment_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  enabled boolean := false;
  business_name text;
  business_timezone text;
  phone_number_id text;
  customer_wa_id text;
  last_inbound timestamptz;
  window_expires timestamptz;
  initial_status text;
  eta_text text;
  contact_text text;
  provider_text text;
  reference_text text;
  dispatch_message text;
begin
  if new.fulfillment_status is not distinct from old.fulfillment_status
     or new.fulfillment_status <> 'out_for_delivery' then
    return new;
  end if;

  select
    t.name,
    t.timezone,
    t.whatsapp_phone_number_id,
    c.wa_id,
    coalesce(s.notify_ready, true)
  into business_name, business_timezone, phone_number_id, customer_wa_id, enabled
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

  provider_text := case
    when nullif(btrim(new.delivery_provider),'') is not null
      then 'Delivery: ' || btrim(new.delivery_provider)
    else null
  end;

  contact_text := case
    when nullif(btrim(new.delivery_contact_name),'') is not null
         and nullif(btrim(new.delivery_contact_phone),'') is not null
      then 'Contact: ' || btrim(new.delivery_contact_name) || ' · ' || btrim(new.delivery_contact_phone)
    when nullif(btrim(new.delivery_contact_name),'') is not null
      then 'Contact: ' || btrim(new.delivery_contact_name)
    when nullif(btrim(new.delivery_contact_phone),'') is not null
      then 'Contact: ' || btrim(new.delivery_contact_phone)
    else null
  end;

  reference_text := case
    when nullif(btrim(new.delivery_reference),'') is not null
      then 'Reference: ' || btrim(new.delivery_reference)
    else null
  end;

  if new.estimated_delivery_at is not null then
    begin
      eta_text := 'ETA: ' || to_char(
        new.estimated_delivery_at at time zone coalesce(nullif(btrim(business_timezone),''),'Africa/Lagos'),
        'DD Mon YYYY HH24:MI'
      ) || ' (' || coalesce(nullif(btrim(business_timezone),''),'Africa/Lagos') || ')';
    exception when others then
      eta_text := 'ETA: ' || to_char(new.estimated_delivery_at at time zone 'UTC','DD Mon YYYY HH24:MI') || ' (UTC)';
    end;
  end if;

  dispatch_message := concat_ws(
    E'\n',
    format('Your order from %s is out for delivery.', business_name),
    provider_text,
    contact_text,
    reference_text,
    eta_text,
    'When it arrives, reply RECEIVED to confirm receipt.'
  );

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
    dispatch_message,
    window_expires
  )
  on conflict (order_id, event_key) do nothing;

  return new;
end;
$$;

revoke all on function public.queue_sellertray_fulfillment_notification() from public,anon,authenticated;

commit;
