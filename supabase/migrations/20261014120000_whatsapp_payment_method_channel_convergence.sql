begin;

-- Customer-facing WhatsApp notifications must never advertise a physical in-person terminal.
-- Cash drawer and card-terminal settlement remain merchant operational methods, while WhatsApp
-- can offer only payment methods a remote customer can actually use.
create or replace function public.queue_orderdesk_notification()
returns trigger
language plpgsql
security definer
set search_path=''
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
  invoice_ref text;
  payment_methods text;
  formatted_total text;
begin
  if tg_op='INSERT' then
    if new.source<>'whatsapp' then return new; end if;
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

  if event_name is null then return new; end if;

  select
    t.name,t.whatsapp_phone_number_id,c.wa_id,
    case event_name
      when 'order_received' then coalesce(s.notify_received,true)
      when 'order_accepted' then coalesce(s.notify_accepted,true)
      when 'order_ready' then coalesce(s.notify_ready,true)
      when 'order_rejected' then coalesce(s.notify_rejected,true)
      when 'order_cancelled' then coalesce(s.notify_cancelled,true)
      else false
    end
  into business_name,phone_number_id,customer_wa_id,enabled
  from public.tenants t
  join public.customers c
    on c.id=new.customer_id and c.tenant_id=new.tenant_id
  left join public.tenant_notification_settings s on s.tenant_id=new.tenant_id
  where t.id=new.tenant_id;

  if enabled is distinct from true then return new; end if;
  if phone_number_id is null or customer_wa_id is null or customer_wa_id like 'manual:%' then return new; end if;

  select max(im.received_at) into last_inbound
  from public.inbound_messages im
  where im.tenant_id=new.tenant_id and im.customer_id=new.customer_id;

  if last_inbound is not null then window_expires := last_inbound + interval '24 hours'; end if;
  initial_status := case when window_expires is null or window_expires<=now()
                         then 'template_required' else 'pending' end;

  order_currency := coalesce(new.currency,'NGN');

  if event_name='order_accepted' then
    select d.amount,d.document_reference
    into order_total,invoice_ref
    from public.order_financial_documents d
    where d.tenant_id=new.tenant_id
      and d.order_id=new.id
      and d.document_type='invoice'
      and d.status='issued';

    select string_agg(m.display_name,', ' order by m.sort_order,m.created_at)
    into payment_methods
    from public.merchant_payment_methods m
    where m.tenant_id=new.tenant_id
      and m.is_enabled=true
      and m.method_type in ('bank_transfer','paystack','flutterwave','cash_on_delivery','pay_on_pickup');

    formatted_total := case
      when order_currency='NGN' then '₦'||trim(to_char(coalesce(order_total,0),'FM999,999,999,990.00'))
      else order_currency||' '||trim(to_char(coalesce(order_total,0),'FM999,999,999,990.00'))
    end;
  end if;

  body_text := case event_name
    when 'order_received' then format(
      'We received your order at %s. Order Ref: %s. Keep this reference in case you have more than one active order. You can ask for the order status or receipt naturally at any time.',
      business_name,new.public_order_id
    )
    when 'order_accepted' then
      case
        when payment_methods is not null then format(
          'Order %s is confirmed with %s. Invoice: %s. Total: %s. Payment options: %s. Just tell us how you would like to pay. You can also ask for your invoice anytime.',
          new.public_order_id,business_name,coalesce(invoice_ref,new.public_order_id),
          formatted_total,payment_methods
        )
        else format(
          'Order %s is confirmed with %s. Invoice: %s. Total: %s. You can ask for your invoice anytime. We will let you know when the order is ready.',
          new.public_order_id,business_name,coalesce(invoice_ref,new.public_order_id),
          formatted_total
        )
      end
    when 'order_ready' then format('Order %s from %s is ready.',new.public_order_id,business_name)
    when 'order_rejected' then format(
      'Order %s with %s could not be accepted. Please contact us if you need help.',
      new.public_order_id,business_name
    )
    when 'order_cancelled' then format('Order %s with %s has been cancelled.',new.public_order_id,business_name)
    else null
  end;

  insert into public.outbound_notifications (
    tenant_id,order_id,customer_id,event_key,delivery_status,
    from_phone_number_id,to_wa_id,message_body,conversation_window_expires_at
  ) values (
    new.tenant_id,new.id,new.customer_id,event_name,initial_status,
    phone_number_id,customer_wa_id,body_text,window_expires
  )
  on conflict do nothing;

  return new;
end;
$$;

revoke all on function public.queue_orderdesk_notification() from public,anon,authenticated;

commit;
