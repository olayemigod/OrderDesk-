-- SellerTray Build 7 P3-P8 orchestration foundation.
-- Extends payment UX/audit while preserving legacy order-receipt semantics.

begin;

alter table public.customers
  add column if not exists email text;

alter table public.customers
  add constraint customers_email_check
  check (
    email is null
    or (
      char_length(email) between 3 and 320
      and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    )
  );

create index if not exists customers_tenant_email_idx
  on public.customers(tenant_id,email)
  where email is not null;

alter table public.order_payments
  add column if not exists checkout_url text,
  add column if not exists provider_transaction_id text,
  add column if not exists last_verified_at timestamptz;

alter table public.order_payments
  add constraint order_payments_checkout_url_check
    check (checkout_url is null or (char_length(checkout_url)<=2000 and checkout_url ~ '^https://')),
  add constraint order_payments_provider_transaction_id_check
    check (
      provider_transaction_id is null
      or (
        char_length(provider_transaction_id) between 1 and 128
        and provider_transaction_id !~ '/'
        and provider_transaction_id ~ '^[A-Za-z0-9._:-]+$'
      )
    );

create unique index order_payments_provider_transaction_key
  on public.order_payments(tenant_id,provider,provider_transaction_id)
  where provider_transaction_id is not null;

create table public.order_payment_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  order_id uuid not null,
  payment_id uuid not null,
  provider text not null,
  event_key text not null,
  event_type text not null,
  source text not null,
  verification_status text not null default 'received',
  provider_event_id text,
  provider_transaction_id text,
  payload_sha256 text,
  verification_result jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint order_payment_events_payment_same_order
    foreign key (tenant_id,order_id,payment_id)
    references public.order_payments(tenant_id,order_id,id)
    on delete cascade,
  constraint order_payment_events_source_check
    check (source=any(array['webhook'::text,'verify'::text,'staff'::text,'system'::text])),
  constraint order_payment_events_verification_status_check
    check (verification_status=any(array[
      'received'::text,'verified'::text,'ignored'::text,'rejected'::text,'failed'::text
    ])),
  constraint order_payment_events_event_key_check
    check (char_length(event_key) between 1 and 180),
  constraint order_payment_events_event_type_check
    check (char_length(event_type) between 1 and 80),
  constraint order_payment_events_provider_event_id_check
    check (provider_event_id is null or char_length(provider_event_id)<=180),
  constraint order_payment_events_provider_transaction_id_check
    check (provider_transaction_id is null or char_length(provider_transaction_id)<=128),
  constraint order_payment_events_payload_sha256_check
    check (payload_sha256 is null or payload_sha256 ~ '^[A-F0-9]{64}$')
);

create unique index order_payment_events_replay_key
  on public.order_payment_events(tenant_id,provider,event_key);

create index order_payment_events_payment_created_idx
  on public.order_payment_events(payment_id,created_at desc);

alter table public.order_payment_events enable row level security;
revoke all on table public.order_payment_events from public,anon,authenticated;
grant select on table public.order_payment_events to authenticated;
grant all on table public.order_payment_events to service_role;

create policy order_payment_events_select_member
on public.order_payment_events
for select to authenticated
using (
  exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id=order_payment_events.tenant_id
      and tm.user_id=(select auth.uid())
  )
);

alter table public.outbound_notifications
  drop constraint outbound_notifications_event_key_check;

alter table public.outbound_notifications
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
    'payment_options'::text,
    'payment_instructions'::text,
    'payment_claim_received'::text,
    'payment_confirmed'::text,
    'payment_status_reply'::text,
    'financial_document'::text
  ]));

drop index if exists public.outbound_notifications_query_response_unique_idx;
create unique index outbound_notifications_query_response_unique_idx
  on public.outbound_notifications(source_inbound_message_id,event_key)
  where source_inbound_message_id is not null
    and event_key=any(array[
      'order_status_reply'::text,
      'order_receipt'::text,
      'payment_options'::text,
      'payment_instructions'::text,
      'payment_claim_received'::text,
      'payment_status_reply'::text,
      'financial_document'::text
    ]);

drop index if exists public.outbound_notifications_lifecycle_unique_idx;
create unique index outbound_notifications_lifecycle_unique_idx
  on public.outbound_notifications(order_id,event_key)
  where event_key=any(array[
    'order_received'::text,
    'order_accepted'::text,
    'order_ready'::text,
    'order_out_for_delivery'::text,
    'order_rejected'::text,
    'order_cancelled'::text,
    'payment_confirmed'::text
  ]);

create or replace function public.set_sellertray_payment_checkout(
  p_payment_id uuid,
  p_checkout_url text,
  p_provider_transaction_id text default null
)
returns void
language plpgsql
security definer
set search_path=''
as $$
begin
  if p_checkout_url is null or p_checkout_url !~ '^https://' then
    raise exception 'SellerTray checkout URL must use HTTPS' using errcode='22023';
  end if;

  update public.order_payments
  set checkout_url=coalesce(checkout_url,p_checkout_url),
      provider_transaction_id=coalesce(provider_transaction_id,nullif(btrim(p_provider_transaction_id),'')),
      updated_at=now()
  where id=p_payment_id
    and status in ('initiated','pending_verification');

  if not found then
    raise exception 'SellerTray payment is not eligible for checkout update' using errcode='23514';
  end if;
end;
$$;

revoke all on function public.set_sellertray_payment_checkout(uuid,text,text) from public,anon,authenticated;
grant execute on function public.set_sellertray_payment_checkout(uuid,text,text) to service_role;

create or replace function public.mark_sellertray_payment_verified(
  p_payment_id uuid,
  p_provider_transaction_id text default null
)
returns void
language plpgsql
security definer
set search_path=''
as $$
begin
  update public.order_payments
  set provider_transaction_id=coalesce(provider_transaction_id,nullif(btrim(p_provider_transaction_id),'')),
      last_verified_at=now(),
      updated_at=now()
  where id=p_payment_id;

  if not found then
    raise exception 'SellerTray payment not found' using errcode='22023';
  end if;
end;
$$;

revoke all on function public.mark_sellertray_payment_verified(uuid,text) from public,anon,authenticated;
grant execute on function public.mark_sellertray_payment_verified(uuid,text) to service_role;

create or replace function public.record_sellertray_payment_event(
  p_tenant_id uuid,
  p_order_id uuid,
  p_payment_id uuid,
  p_provider text,
  p_event_key text,
  p_event_type text,
  p_source text,
  p_verification_status text,
  p_provider_event_id text default null,
  p_provider_transaction_id text default null,
  p_payload_sha256 text default null,
  p_verification_result jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_id uuid;
begin
  insert into public.order_payment_events (
    tenant_id,order_id,payment_id,provider,event_key,event_type,source,
    verification_status,provider_event_id,provider_transaction_id,payload_sha256,
    verification_result,processed_at
  ) values (
    p_tenant_id,p_order_id,p_payment_id,p_provider,p_event_key,p_event_type,p_source,
    p_verification_status,nullif(btrim(p_provider_event_id),''),
    nullif(btrim(p_provider_transaction_id),''),
    nullif(upper(btrim(p_payload_sha256)),''),
    coalesce(p_verification_result,'{}'::jsonb),
    case when p_verification_status<>'received' then now() else null end
  )
  on conflict (tenant_id,provider,event_key) do update
  set verification_status=excluded.verification_status,
      provider_event_id=coalesce(public.order_payment_events.provider_event_id,excluded.provider_event_id),
      provider_transaction_id=coalesce(public.order_payment_events.provider_transaction_id,excluded.provider_transaction_id),
      payload_sha256=coalesce(public.order_payment_events.payload_sha256,excluded.payload_sha256),
      verification_result=excluded.verification_result,
      processed_at=case when excluded.verification_status<>'received' then now()
                        else public.order_payment_events.processed_at end
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.record_sellertray_payment_event(uuid,uuid,uuid,text,text,text,text,text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.record_sellertray_payment_event(uuid,uuid,uuid,text,text,text,text,text,text,text,text,jsonb) to service_role;

create or replace function public.confirm_sellertray_offline_payment(
  p_payment_id uuid,
  p_actor_user_id uuid,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_payment public.order_payments%rowtype;
begin
  select * into v_payment
  from public.order_payments p
  where p.id=p_payment_id
  for update;

  if not found then
    raise exception 'SellerTray payment not found' using errcode='22023';
  end if;

  if v_payment.method_type not in ('bank_transfer','cash_on_delivery','pay_on_pickup') then
    raise exception 'Only offline SellerTray payments can be confirmed manually' using errcode='23514';
  end if;

  if v_payment.status not in ('initiated','pending_verification') then
    raise exception 'SellerTray payment is not awaiting confirmation' using errcode='23514';
  end if;

  if not exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id=v_payment.tenant_id and tm.user_id=p_actor_user_id
  ) then
    raise exception 'SellerTray payment confirmation requires a tenant member' using errcode='42501';
  end if;

  perform public.transition_sellertray_order_payment(
    p_payment_id,
    'confirmed',
    'staff',
    p_actor_user_id,
    null,
    null
  );

  perform public.record_sellertray_payment_event(
    v_payment.tenant_id,
    v_payment.order_id,
    v_payment.id,
    v_payment.provider,
    'staff:' || v_payment.id::text || ':' || p_actor_user_id::text,
    'manual_confirmation',
    'staff',
    'verified',
    null,
    null,
    null,
    jsonb_build_object('note',left(coalesce(p_note,''),500))
  );

  return p_payment_id;
end;
$$;

revoke all on function public.confirm_sellertray_offline_payment(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.confirm_sellertray_offline_payment(uuid,uuid,text) to service_role;

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
  end if;

  body_text := case event_name
    when 'order_received' then format(
      'We received your order at %s. Order Ref: %s. Save this reference. You can ask "status %s" or "receipt %s" on WhatsApp at any time.',
      business_name,new.public_order_id,new.public_order_id,new.public_order_id
    )
    when 'order_accepted' then
      case
        when payment_methods is not null then format(
          'Order %s is confirmed with %s. Invoice: %s. Total: %s %s. Payment options: %s. Reply "PAY %s" to choose how to pay.',
          new.public_order_id,business_name,coalesce(invoice_ref,new.public_order_id),
          order_currency,trim(to_char(coalesce(order_total,0),'FM999999999990.00')),
          payment_methods,new.public_order_id
        )
        else format(
          'Order %s is confirmed with %s. Invoice: %s. Total: %s %s. We will let you know when it is ready.',
          new.public_order_id,business_name,coalesce(invoice_ref,new.public_order_id),
          order_currency,trim(to_char(coalesce(order_total,0),'FM999999999990.00'))
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

create or replace function public.queue_sellertray_payment_confirmation()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
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

  insert into public.outbound_notifications (
    tenant_id,order_id,customer_id,event_key,delivery_status,
    from_phone_number_id,to_wa_id,message_body,conversation_window_expires_at
  ) values (
    new.tenant_id,new.order_id,v_customer_id,'payment_confirmed',v_initial_status,
    v_phone_number_id,v_customer_wa_id,
    format(
      'Payment confirmed for order %s with %s. Amount: %s %s. Financial Receipt: %s. Reply "PAYMENT RECEIPT %s" when you need the payment receipt.',
      v_order_ref,v_business_name,coalesce(v_currency,new.currency),
      trim(to_char(coalesce(v_amount,new.amount),'FM999999999990.00')),
      v_receipt_ref,v_order_ref
    ),
    v_window_expires
  )
  on conflict do nothing;

  return new;
end;
$$;

revoke all on function public.queue_sellertray_payment_confirmation() from public,anon,authenticated;

drop trigger if exists zz_queue_sellertray_payment_confirmation on public.order_payments;
create trigger zz_queue_sellertray_payment_confirmation
after update of status on public.order_payments
for each row
when (old.status is distinct from new.status)
execute function public.queue_sellertray_payment_confirmation();

commit;