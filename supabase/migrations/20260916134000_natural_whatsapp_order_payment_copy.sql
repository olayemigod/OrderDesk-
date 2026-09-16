create or replace function public.queue_orderdesk_notification()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
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
    where m.tenant_id=new.tenant_id and m.is_enabled=true;

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
$function$;

create or replace function public.queue_sellertray_payment_confirmation()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_business_name text;
  v_phone_number_id text;
  v_customer_wa_id text;
  v_customer_id uuid;
  v_order_ref text;
  v_receipt_ref text;
  v_currency text;
  v_amount numeric(14,2);
  v_last_inbound timestamptz;
  v_window_expires timestamptz;
  v_initial_status text;
  v_formatted_amount text;
begin
  if new.status<>'confirmed' or old.status is not distinct from new.status then
    return new;
  end if;

  select t.name,t.whatsapp_phone_number_id,c.wa_id,c.id,o.public_order_id
  into v_business_name,v_phone_number_id,v_customer_wa_id,v_customer_id,v_order_ref
  from public.orders o
  join public.tenants t on t.id=o.tenant_id
  join public.customers c on c.id=o.customer_id and c.tenant_id=o.tenant_id
  where o.id=new.order_id and o.tenant_id=new.tenant_id;

  if v_phone_number_id is null or v_customer_wa_id is null or v_customer_wa_id like 'manual:%' then
    return new;
  end if;

  select d.document_reference,d.currency,d.amount
  into v_receipt_ref,v_currency,v_amount
  from public.order_financial_documents d
  where d.tenant_id=new.tenant_id
    and d.order_id=new.order_id
    and d.document_type='receipt'
    and d.payment_id=new.id;

  if v_receipt_ref is null then
    raise exception 'SellerTray confirmed payment is missing financial receipt' using errcode='23514';
  end if;

  select max(im.received_at) into v_last_inbound
  from public.inbound_messages im
  where im.tenant_id=new.tenant_id and im.customer_id=v_customer_id;

  if v_last_inbound is not null then v_window_expires := v_last_inbound + interval '24 hours'; end if;
  v_initial_status := case when v_window_expires is null or v_window_expires<=now()
                           then 'template_required' else 'pending' end;

  v_currency := coalesce(v_currency,new.currency,'NGN');
  v_formatted_amount := case
    when v_currency='NGN' then '₦'||trim(to_char(coalesce(v_amount,new.amount),'FM999,999,999,990.00'))
    else v_currency||' '||trim(to_char(coalesce(v_amount,new.amount),'FM999,999,999,990.00'))
  end;

  insert into public.outbound_notifications (
    tenant_id,order_id,customer_id,event_key,delivery_status,
    from_phone_number_id,to_wa_id,message_body,conversation_window_expires_at
  ) values (
    new.tenant_id,new.order_id,v_customer_id,'payment_confirmed',v_initial_status,
    v_phone_number_id,v_customer_wa_id,
    format(
      'Payment confirmed for order %s with %s. Amount: %s. Receipt: %s. You can ask for your payment receipt anytime.',
      v_order_ref,v_business_name,v_formatted_amount,v_receipt_ref
    ),
    v_window_expires
  )
  on conflict do nothing;

  return new;
end;
$function$;
