-- SellerTray Patch 10: alert merchants when a ready order is blocked by payment policy.

alter table public.merchant_notifications
  drop constraint if exists merchant_notifications_event_check;

alter table public.merchant_notifications
  add constraint merchant_notifications_event_check
  check (event_key in (
    'new_whatsapp_order',
    'order_change_request',
    'new_whatsapp_message',
    'payment_verification_required',
    'payment_confirmed',
    'payment_failed',
    'payment_exception',
    'payment_gate_blocked'
  ));

create unique index if not exists merchant_notifications_gate_order_uniq
  on public.merchant_notifications(event_key,order_id)
  where event_key='payment_gate_blocked' and order_id is not null;

create or replace function public.queue_sellertray_payment_gate_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_decision jsonb;
  v_customer text;
  v_order_ref text;
begin
  if new.status <> 'ready'
     or old.status is not distinct from new.status then
    return new;
  end if;

  v_decision := public.sellertray_payment_gate_decision(new.id,'dispatch');
  if coalesce((v_decision->>'allowed')::boolean,false) is true then
    return new;
  end if;

  select o.public_order_id,
         coalesce(nullif(btrim(c.display_name),''),c.phone,c.wa_id,'Customer')
  into v_order_ref,v_customer
  from public.orders o
  join public.customers c
    on c.id=o.customer_id and c.tenant_id=o.tenant_id
  where o.id=new.id and o.tenant_id=new.tenant_id;

  insert into public.merchant_notifications(
    tenant_id,event_key,severity,title,body,order_id
  )
  values(
    new.tenant_id,
    'payment_gate_blocked',
    'attention',
    'Order ready · payment required',
    coalesce(v_customer,'Customer') || ' · ' || coalesce(v_order_ref,'Order') || '. ' ||
      coalesce(v_decision->>'reason','Payment must be resolved before fulfilment.'),
    new.id
  )
  on conflict do nothing;

  return new;
end;
$$;

revoke all on function public.queue_sellertray_payment_gate_notification()
from public,anon,authenticated;

drop trigger if exists queue_sellertray_payment_gate_notification on public.orders;
create trigger queue_sellertray_payment_gate_notification
after update of status on public.orders
for each row execute function public.queue_sellertray_payment_gate_notification();
