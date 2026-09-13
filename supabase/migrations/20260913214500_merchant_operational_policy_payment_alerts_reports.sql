-- SellerTray Patch 10: merchant operational policy, payment alerts, quiet WhatsApp push defaults and reports.

create table if not exists public.merchant_operational_policies (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  payment_gate text not null default 'before_fulfillment'
    check (payment_gate in ('none','before_processing','before_ready','before_fulfillment')),
  allow_cod_dispatch_unpaid boolean not null default true,
  require_cod_payment_before_completion boolean not null default true,
  allow_pickup_ready_unpaid boolean not null default true,
  require_pickup_payment_before_completion boolean not null default true,
  require_delivery_provider boolean not null default false,
  require_delivery_reference boolean not null default false,
  require_customer_delivery_confirmation boolean not null default false,
  whatsapp_push_mode text not null default 'actionable_only'
    check (whatsapp_push_mode in ('actionable_only','all_messages','orders_payments_only')),
  updated_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.merchant_operational_policies enable row level security;
revoke all on table public.merchant_operational_policies from public, anon, authenticated;
grant select on table public.merchant_operational_policies to authenticated;
grant all on table public.merchant_operational_policies to service_role;

drop policy if exists merchant_operational_policies_member_read on public.merchant_operational_policies;
create policy merchant_operational_policies_member_read
on public.merchant_operational_policies
for select
to authenticated
using (
  auth.uid() is not null
  and exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = merchant_operational_policies.tenant_id
      and tm.user_id = auth.uid()
  )
);

create or replace function public.sellertray_get_operational_policy(p_tenant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_result jsonb;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = p_tenant_id and tm.user_id = v_user_id
  ) then
    raise exception 'SellerTray business membership required';
  end if;

  select jsonb_build_object(
    'paymentGate', p.payment_gate,
    'allowCodDispatchUnpaid', p.allow_cod_dispatch_unpaid,
    'requireCodPaymentBeforeCompletion', p.require_cod_payment_before_completion,
    'allowPickupReadyUnpaid', p.allow_pickup_ready_unpaid,
    'requirePickupPaymentBeforeCompletion', p.require_pickup_payment_before_completion,
    'requireDeliveryProvider', p.require_delivery_provider,
    'requireDeliveryReference', p.require_delivery_reference,
    'requireCustomerDeliveryConfirmation', p.require_customer_delivery_confirmation,
    'whatsappPushMode', p.whatsapp_push_mode
  )
  into v_result
  from public.merchant_operational_policies p
  where p.tenant_id = p_tenant_id;

  return coalesce(v_result, jsonb_build_object(
    'paymentGate', 'before_fulfillment',
    'allowCodDispatchUnpaid', true,
    'requireCodPaymentBeforeCompletion', true,
    'allowPickupReadyUnpaid', true,
    'requirePickupPaymentBeforeCompletion', true,
    'requireDeliveryProvider', false,
    'requireDeliveryReference', false,
    'requireCustomerDeliveryConfirmation', false,
    'whatsappPushMode', 'actionable_only'
  ));
end;
$$;

revoke all on function public.sellertray_get_operational_policy(uuid) from public, anon;
grant execute on function public.sellertray_get_operational_policy(uuid) to authenticated, service_role;

create or replace function public.sellertray_save_operational_policy(
  p_tenant_id uuid,
  p_payment_gate text,
  p_allow_cod_dispatch_unpaid boolean,
  p_require_cod_payment_before_completion boolean,
  p_allow_pickup_ready_unpaid boolean,
  p_require_pickup_payment_before_completion boolean,
  p_require_delivery_provider boolean,
  p_require_delivery_reference boolean,
  p_require_customer_delivery_confirmation boolean,
  p_whatsapp_push_mode text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_role text;
  v_can_write boolean;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id = p_tenant_id and tm.user_id = v_user_id;

  if v_role not in ('owner','manager') then
    raise exception 'Only an Owner or Manager can change operational policy';
  end if;

  select public.orderdesk_subscription_can_write(p_tenant_id) into v_can_write;
  if v_can_write is not true then
    raise exception 'SellerTray subscription is read-only. Renew or reactivate the business to make changes.';
  end if;

  if p_payment_gate not in ('none','before_processing','before_ready','before_fulfillment') then
    raise exception 'Invalid payment gate';
  end if;
  if p_whatsapp_push_mode not in ('actionable_only','all_messages','orders_payments_only') then
    raise exception 'Invalid WhatsApp push mode';
  end if;

  insert into public.merchant_operational_policies (
    tenant_id,payment_gate,allow_cod_dispatch_unpaid,require_cod_payment_before_completion,
    allow_pickup_ready_unpaid,require_pickup_payment_before_completion,
    require_delivery_provider,require_delivery_reference,require_customer_delivery_confirmation,
    whatsapp_push_mode,updated_by_user_id,updated_at
  )
  values (
    p_tenant_id,p_payment_gate,p_allow_cod_dispatch_unpaid,p_require_cod_payment_before_completion,
    p_allow_pickup_ready_unpaid,p_require_pickup_payment_before_completion,
    p_require_delivery_provider,p_require_delivery_reference,p_require_customer_delivery_confirmation,
    p_whatsapp_push_mode,v_user_id,now()
  )
  on conflict (tenant_id) do update
  set payment_gate = excluded.payment_gate,
      allow_cod_dispatch_unpaid = excluded.allow_cod_dispatch_unpaid,
      require_cod_payment_before_completion = excluded.require_cod_payment_before_completion,
      allow_pickup_ready_unpaid = excluded.allow_pickup_ready_unpaid,
      require_pickup_payment_before_completion = excluded.require_pickup_payment_before_completion,
      require_delivery_provider = excluded.require_delivery_provider,
      require_delivery_reference = excluded.require_delivery_reference,
      require_customer_delivery_confirmation = excluded.require_customer_delivery_confirmation,
      whatsapp_push_mode = excluded.whatsapp_push_mode,
      updated_by_user_id = excluded.updated_by_user_id,
      updated_at = now();

  return public.sellertray_get_operational_policy(p_tenant_id);
end;
$$;

revoke all on function public.sellertray_save_operational_policy(uuid,text,boolean,boolean,boolean,boolean,boolean,boolean,boolean,text) from public, anon;
grant execute on function public.sellertray_save_operational_policy(uuid,text,boolean,boolean,boolean,boolean,boolean,boolean,boolean,text) to authenticated, service_role;

create or replace function public.sellertray_payment_gate_decision(p_order_id uuid, p_stage text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_payment_status text;
  v_method text;
  v_policy public.merchant_operational_policies%rowtype;
  v_gate text := 'before_fulfillment';
  v_allow_cod_dispatch boolean := true;
  v_require_cod_complete boolean := true;
  v_allow_pickup_ready boolean := true;
  v_require_pickup_complete boolean := true;
begin
  select o.tenant_id, o.payment_status into v_tenant_id, v_payment_status
  from public.orders o where o.id = p_order_id;

  if v_tenant_id is null then
    return jsonb_build_object('allowed', false, 'reason', 'Order not found', 'paymentMethod', null);
  end if;

  select p.* into v_policy from public.merchant_operational_policies p where p.tenant_id = v_tenant_id;
  if found then
    v_gate := v_policy.payment_gate;
    v_allow_cod_dispatch := v_policy.allow_cod_dispatch_unpaid;
    v_require_cod_complete := v_policy.require_cod_payment_before_completion;
    v_allow_pickup_ready := v_policy.allow_pickup_ready_unpaid;
    v_require_pickup_complete := v_policy.require_pickup_payment_before_completion;
  end if;

  select op.method_type into v_method
  from public.order_payments op
  where op.tenant_id = v_tenant_id and op.order_id = p_order_id and op.status <> 'failed'
  order by op.created_at desc limit 1;

  if v_payment_status = 'paid' then
    return jsonb_build_object('allowed', true, 'reason', null, 'paymentMethod', v_method);
  end if;

  if p_stage = 'processing' then
    if v_gate = 'before_processing' and coalesce(v_method,'') not in ('cash_on_delivery','pay_on_pickup') then
      return jsonb_build_object('allowed', false, 'reason', 'Payment must be confirmed before this order can start processing.', 'paymentMethod', v_method);
    end if;
    return jsonb_build_object('allowed', true, 'reason', null, 'paymentMethod', v_method);
  end if;

  if p_stage = 'ready' then
    if v_gate in ('before_processing','before_ready')
       and not (v_method = 'cash_on_delivery' or (v_method = 'pay_on_pickup' and v_allow_pickup_ready)) then
      return jsonb_build_object('allowed', false, 'reason', 'Payment must be confirmed before this order can be marked ready.', 'paymentMethod', v_method);
    end if;
    return jsonb_build_object('allowed', true, 'reason', null, 'paymentMethod', v_method);
  end if;

  if p_stage = 'dispatch' then
    if v_gate = 'none' then
      return jsonb_build_object('allowed', true, 'reason', null, 'paymentMethod', v_method);
    end if;
    if v_method = 'cash_on_delivery' and v_allow_cod_dispatch then
      return jsonb_build_object('allowed', true, 'reason', null, 'paymentMethod', v_method);
    end if;
    return jsonb_build_object('allowed', false, 'reason', 'Payment policy blocks dispatch until payment is confirmed.', 'paymentMethod', v_method);
  end if;

  if p_stage = 'complete' then
    if v_method = 'cash_on_delivery' and v_require_cod_complete then
      return jsonb_build_object('allowed', false, 'reason', 'Confirm cash-on-delivery payment before completing this order.', 'paymentMethod', v_method);
    end if;
    if v_method = 'pay_on_pickup' and v_require_pickup_complete then
      return jsonb_build_object('allowed', false, 'reason', 'Confirm pickup payment before completing this order.', 'paymentMethod', v_method);
    end if;
    if v_gate <> 'none' then
      return jsonb_build_object('allowed', false, 'reason', 'Payment policy blocks completion until payment is confirmed.', 'paymentMethod', v_method);
    end if;
    return jsonb_build_object('allowed', true, 'reason', null, 'paymentMethod', v_method);
  end if;

  return jsonb_build_object('allowed', true, 'reason', null, 'paymentMethod', v_method);
end;
$$;

revoke all on function public.sellertray_payment_gate_decision(uuid,text) from public, anon, authenticated;
grant execute on function public.sellertray_payment_gate_decision(uuid,text) to service_role;

create or replace function public.guard_order_status_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_decision jsonb;
begin
  if new.status = old.status then return new; end if;
  if old.status in ('completed','rejected','cancelled') then
    raise exception 'Order status % is terminal', old.status using errcode='23514';
  end if;

  if new.status='accepted' then
    if old.status not in ('draft','needs_review') then
      raise exception 'Order cannot move from % to accepted', old.status using errcode='23514';
    end if;
    if not exists (
      select 1 from public.order_items oi where oi.tenant_id=new.tenant_id and oi.order_id=new.id
    ) then
      raise exception 'Order must contain at least one item before acceptance' using errcode='23514';
    end if;
    if exists (
      select 1 from public.order_items oi
      where oi.tenant_id=new.tenant_id and oi.order_id=new.id and oi.unit_price is null
    ) then
      raise exception 'All order items must be priced before acceptance' using errcode='23514';
    end if;
    return new;
  end if;

  if new.status='rejected' and old.status in ('draft','needs_review') then return new; end if;

  if new.status='processing' and old.status='accepted' then
    v_decision := public.sellertray_payment_gate_decision(new.id,'processing');
    if coalesce((v_decision->>'allowed')::boolean,false) is not true then
      raise exception '%', coalesce(v_decision->>'reason','Payment policy blocks processing') using errcode='23514';
    end if;
    return new;
  end if;

  if new.status='ready' and old.status='processing' then
    v_decision := public.sellertray_payment_gate_decision(new.id,'ready');
    if coalesce((v_decision->>'allowed')::boolean,false) is not true then
      raise exception '%', coalesce(v_decision->>'reason','Payment policy blocks ready status') using errcode='23514';
    end if;
    return new;
  end if;

  if new.status='completed' and old.status='ready' then
    if new.fulfillment_method is null
       or new.fulfillment_status not in ('delivered','collected')
       or new.fulfilled_at is null
       or new.fulfillment_confirmed_by not in ('merchant','customer_whatsapp') then
      raise exception 'Completed SellerTray orders require governed fulfillment evidence' using errcode='23514';
    end if;
    if new.fulfillment_method='customer_pickup' and new.fulfillment_status<>'collected' then
      raise exception 'Customer pickup must complete as collected' using errcode='23514';
    end if;
    if new.fulfillment_method in ('merchant_delivery','third_party_delivery') and new.fulfillment_status<>'delivered' then
      raise exception 'Delivery fulfillment must complete as delivered' using errcode='23514';
    end if;
    v_decision := public.sellertray_payment_gate_decision(new.id,'complete');
    if coalesce((v_decision->>'allowed')::boolean,false) is not true then
      raise exception '%', coalesce(v_decision->>'reason','Payment policy blocks completion') using errcode='23514';
    end if;
    return new;
  end if;

  if new.status='cancelled' and old.status in ('accepted','processing','ready') then return new; end if;
  raise exception 'Invalid order status transition: % -> %', old.status, new.status using errcode='23514';
end;
$$;

create or replace function public.guard_sellertray_fulfillment_policy()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_policy public.merchant_operational_policies%rowtype;
  v_has_policy boolean := false;
  v_decision jsonb;
begin
  select p.* into v_policy from public.merchant_operational_policies p where p.tenant_id=new.tenant_id;
  v_has_policy := found;

  if new.fulfillment_status is distinct from old.fulfillment_status then
    if new.fulfillment_status='out_for_delivery' then
      v_decision := public.sellertray_payment_gate_decision(new.id,'dispatch');
      if coalesce((v_decision->>'allowed')::boolean,false) is not true then
        raise exception '%', coalesce(v_decision->>'reason','Payment policy blocks dispatch') using errcode='23514';
      end if;
      if v_has_policy and new.fulfillment_method in ('merchant_delivery','third_party_delivery') then
        if v_policy.require_delivery_provider and nullif(btrim(coalesce(new.delivery_provider,'')),'') is null then
          raise exception 'Delivery partner / rider is required by merchant policy' using errcode='23514';
        end if;
        if v_policy.require_delivery_reference and nullif(btrim(coalesce(new.delivery_reference,'')),'') is null then
          raise exception 'Delivery reference / rider phone is required by merchant policy' using errcode='23514';
        end if;
      end if;
    end if;

    if new.fulfillment_status in ('delivered','collected') then
      v_decision := public.sellertray_payment_gate_decision(new.id,'complete');
      if coalesce((v_decision->>'allowed')::boolean,false) is not true then
        raise exception '%', coalesce(v_decision->>'reason','Payment policy blocks completion') using errcode='23514';
      end if;
      if v_has_policy and v_policy.require_customer_delivery_confirmation
         and new.fulfillment_confirmed_by<>'customer_whatsapp' then
        raise exception 'Customer WhatsApp confirmation is required before fulfillment can be completed' using errcode='23514';
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_sellertray_fulfillment_policy on public.orders;
create trigger guard_sellertray_fulfillment_policy
before update of fulfillment_status, fulfillment_method, delivery_provider, delivery_reference, fulfillment_confirmed_by
on public.orders
for each row execute function public.guard_sellertray_fulfillment_policy();

alter table public.merchant_notifications
  add column if not exists payment_id uuid references public.order_payments(id) on delete cascade;

alter table public.merchant_notifications drop constraint if exists merchant_notifications_event_check;
alter table public.merchant_notifications
  add constraint merchant_notifications_event_check
  check (event_key in (
    'new_whatsapp_order','order_change_request','new_whatsapp_message',
    'payment_verification_required','payment_confirmed','payment_failed','payment_exception'
  ));

create unique index if not exists merchant_notifications_payment_event_uniq
  on public.merchant_notifications(event_key,payment_id) where payment_id is not null;

create or replace function public.queue_sellertray_payment_merchant_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event text;
  v_severity text;
  v_title text;
  v_body text;
  v_order_ref text;
  v_customer text;
begin
  if new.status='pending_verification' and (tg_op='INSERT' or old.status is distinct from new.status) then
    v_event := 'payment_verification_required'; v_severity := 'urgent';
    v_title := 'Payment needs verification';
    v_body := 'Customer says payment has been made. Verify the funds before continuing.';
  elsif new.status='confirmed' and (tg_op='INSERT' or old.status is distinct from new.status) then
    v_event := 'payment_confirmed'; v_severity := 'info';
    v_title := 'Payment confirmed'; v_body := 'Payment has been confirmed for this order.';
  elsif new.status='failed' and (tg_op='INSERT' or old.status is distinct from new.status) then
    v_event := 'payment_failed'; v_severity := 'attention';
    v_title := 'Payment failed';
    v_body := coalesce(nullif(new.failure_reason,''),'A payment attempt failed and needs attention.');
  elsif new.exception_state<>'none' and (
      tg_op='INSERT' or old.exception_state is distinct from new.exception_state
      or old.exception_reason is distinct from new.exception_reason
    ) then
    v_event := 'payment_exception'; v_severity := 'urgent';
    v_title := 'Payment exception';
    v_body := coalesce(nullif(new.exception_reason,''),'SellerTray found a payment mismatch that needs review.');
  else
    return new;
  end if;

  select o.public_order_id,coalesce(nullif(btrim(c.display_name),''),c.phone,c.wa_id,'Customer')
  into v_order_ref,v_customer
  from public.orders o
  join public.customers c on c.id=o.customer_id and c.tenant_id=o.tenant_id
  where o.id=new.order_id and o.tenant_id=new.tenant_id;

  insert into public.merchant_notifications(
    tenant_id,event_key,severity,title,body,order_id,payment_id
  )
  values(
    new.tenant_id,v_event,v_severity,v_title,
    coalesce(v_customer,'Customer') || ' · ' || coalesce(v_order_ref,'Order') || '. ' || v_body,
    new.order_id,new.id
  )
  on conflict do nothing;

  return new;
end;
$$;

revoke all on function public.queue_sellertray_payment_merchant_notification() from public, anon, authenticated;

drop trigger if exists queue_sellertray_payment_merchant_notification on public.order_payments;
create trigger queue_sellertray_payment_merchant_notification
after insert or update of status,exception_state,exception_reason
on public.order_payments
for each row execute function public.queue_sellertray_payment_merchant_notification();

create or replace function public.queue_sellertray_unhandled_whatsapp_message_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer_name text;
  v_mode text := 'actionable_only';
begin
  if new.processing_status<>'completed' or old.processing_status='completed' then return new; end if;

  if exists (
    select 1 from public.orders o where o.tenant_id=new.tenant_id and o.source_message_id=new.id
  ) or exists (
    select 1 from public.customer_order_change_requests r
    where r.tenant_id=new.tenant_id and r.source_inbound_message_id=new.id
  ) then return new; end if;

  select coalesce(p.whatsapp_push_mode,'actionable_only')
  into v_mode from public.merchant_operational_policies p where p.tenant_id=new.tenant_id;

  if coalesce(v_mode,'actionable_only')<>'all_messages' then return new; end if;

  select coalesce(nullif(btrim(c.display_name),''),c.phone,c.wa_id,'WhatsApp customer')
  into v_customer_name
  from public.customers c where c.id=new.customer_id and c.tenant_id=new.tenant_id;

  insert into public.merchant_notifications(
    tenant_id,event_key,severity,title,body,source_inbound_message_id
  )
  values(
    new.tenant_id,'new_whatsapp_message','info','New WhatsApp message',
    coalesce(v_customer_name,'WhatsApp customer') || ' sent a new message.',new.id
  );
  return new;
end;
$$;

revoke all on function public.queue_sellertray_unhandled_whatsapp_message_notification() from public, anon, authenticated;

create or replace function public.sellertray_report_summary(p_tenant_id uuid,p_days integer default 30)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_days integer := greatest(1,least(coalesce(p_days,30),365));
  v_since timestamptz;
  v_result jsonb;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id
  ) then raise exception 'SellerTray business membership required'; end if;

  v_since := now() - make_interval(days=>v_days);

  with order_stats as (
    select
      count(*)::int as orders,
      count(*) filter (where o.status='completed')::int as completed,
      count(*) filter (where o.status in ('rejected','cancelled'))::int as unsuccessful,
      count(*) filter (where o.source='whatsapp')::int as whatsapp_orders,
      count(*) filter (where o.source='manual')::int as manual_orders,
      count(*) filter (where o.payment_status='paid')::int as paid_orders,
      count(*) filter (
        where o.payment_status in ('unpaid','pending','verification_required','payment_issue')
          and o.status not in ('rejected','cancelled')
      )::int as awaiting_payment,
      coalesce(sum(o.total_amount) filter (where o.status not in ('rejected','cancelled')),0)::numeric as order_value,
      coalesce(sum(o.amount_paid),0)::numeric as paid_value,
      count(*) filter (where o.fulfillment_status='out_for_delivery')::int as out_for_delivery,
      count(*) filter (where o.fulfillment_status='delivered')::int as delivered,
      count(*) filter (where o.fulfillment_status='collected')::int as collected,
      count(*) filter (where o.status='ready' and o.fulfillment_status='unassigned')::int as awaiting_fulfillment
    from public.orders o
    where o.tenant_id=p_tenant_id and o.created_at>=v_since
  ),
  payment_method_stats as (
    select op.method_type,count(*)::int as method_count
    from public.order_payments op
    where op.tenant_id=p_tenant_id and op.created_at>=v_since
    group by op.method_type
  ),
  payment_stats as (
    select
      count(*) filter (where op.status='pending_verification')::int as verification_required,
      count(*) filter (where op.status='failed')::int as failed,
      count(*) filter (where op.exception_state<>'none')::int as exceptions
    from public.order_payments op
    where op.tenant_id=p_tenant_id and op.created_at>=v_since
  ),
  method_json as (
    select coalesce(jsonb_object_agg(pms.method_type,pms.method_count),'{}'::jsonb) as methods
    from payment_method_stats pms
  ),
  top_items as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'name',x.item_name,'quantity',x.quantity,'value',x.value
    ) order by x.value desc,x.quantity desc),'[]'::jsonb) as items
    from (
      select oi.item_name,
             sum(oi.quantity)::numeric as quantity,
             sum(oi.quantity*coalesce(oi.unit_price,0))::numeric as value
      from public.order_items oi
      join public.orders o on o.id=oi.order_id and o.tenant_id=oi.tenant_id
      where oi.tenant_id=p_tenant_id and o.created_at>=v_since and o.status not in ('rejected','cancelled')
      group by oi.item_name
      order by value desc,quantity desc
      limit 10
    ) x
  )
  select jsonb_build_object(
    'days',v_days,
    'orders',jsonb_build_object(
      'total',os.orders,'completed',os.completed,'unsuccessful',os.unsuccessful,
      'whatsapp',os.whatsapp_orders,'manual',os.manual_orders,'orderValue',os.order_value,
      'averageOrderValue',case when os.orders>0 then os.order_value/os.orders else 0 end
    ),
    'payments',jsonb_build_object(
      'paidOrders',os.paid_orders,'awaitingPayment',os.awaiting_payment,'paidValue',os.paid_value,
      'verificationRequired',ps.verification_required,'failed',ps.failed,'exceptions',ps.exceptions,
      'methods',mj.methods
    ),
    'fulfillment',jsonb_build_object(
      'outForDelivery',os.out_for_delivery,'delivered',os.delivered,
      'collected',os.collected,'awaitingFulfillment',os.awaiting_fulfillment
    ),
    'topItems',ti.items
  )
  into v_result
  from order_stats os,payment_stats ps,method_json mj,top_items ti;

  return v_result;
end;
$$;

revoke all on function public.sellertray_report_summary(uuid,integer) from public, anon;
grant execute on function public.sellertray_report_summary(uuid,integer) to authenticated, service_role;
