begin;

alter table public.merchant_notifications
  drop constraint if exists merchant_notifications_event_check,
  add constraint merchant_notifications_event_check
  check (event_key in (
    'new_whatsapp_order',
    'order_change_request',
    'new_whatsapp_message'
  ));

create or replace function public.queue_sellertray_unhandled_whatsapp_message_notification()
returns trigger
language plpgsql
set search_path=''
as $$
declare
  v_customer_name text;
begin
  if new.processing_status <> 'completed'
     or old.processing_status = 'completed' then
    return new;
  end if;

  if exists (
    select 1 from public.orders o
    where o.tenant_id=new.tenant_id and o.source_message_id=new.id
  ) or exists (
    select 1 from public.customer_order_change_requests r
    where r.tenant_id=new.tenant_id and r.source_inbound_message_id=new.id
  ) then
    return new;
  end if;

  select coalesce(nullif(btrim(c.display_name),''),c.phone,c.wa_id,'WhatsApp customer')
  into v_customer_name
  from public.customers c
  where c.tenant_id=new.tenant_id and c.id=new.customer_id;

  insert into public.merchant_notifications(
    tenant_id,event_key,severity,title,body,source_inbound_message_id
  ) values (
    new.tenant_id,
    'new_whatsapp_message',
    'info',
    'New WhatsApp message',
    left(
      coalesce(v_customer_name,'WhatsApp customer') ||
      case
        when nullif(btrim(new.text_body),'') is not null then ': ' || btrim(new.text_body)
        when new.message_type='image' then ' sent an image.'
        else ' sent a message.'
      end,
      1000
    ),
    new.id
  )
  on conflict do nothing;

  return new;
end;
$$;

revoke all on function public.queue_sellertray_unhandled_whatsapp_message_notification()
  from public,anon,authenticated;

drop trigger if exists queue_sellertray_unhandled_whatsapp_message_notification
  on public.inbound_messages;
create trigger queue_sellertray_unhandled_whatsapp_message_notification
after update of processing_status on public.inbound_messages
for each row
execute function public.queue_sellertray_unhandled_whatsapp_message_notification();

commit;
