create or replace function public.reserve_sellertray_installment_checkout(
  p_tenant_id uuid,
  p_installment_schedule_id uuid,
  p_command_id uuid,
  p_actor_user_id uuid,
  p_billing_email text
)
returns jsonb
language plpgsql
set search_path=''
as $$
declare
  v_role text;
  v_email text := lower(btrim(coalesce(p_billing_email,'')));
  v_schedule public.sellertray_commercial_installment_schedule%rowtype;
  v_obligation public.sellertray_commercial_installment_obligations%rowtype;
  v_order public.sellertray_commercial_orders%rowtype;
  v_plan_code text;
  v_state jsonb;
  v_next_schedule_id uuid;
  v_next_amount numeric(18,2);
  v_existing public.billing_checkout_sessions%rowtype;
  v_reference text;
  v_session public.billing_checkout_sessions%rowtype;
begin
  if p_tenant_id is null or p_installment_schedule_id is null
     or p_command_id is null or p_actor_user_id is null then
    raise exception 'Business, installment, command and user are required' using errcode='22023';
  end if;
  if char_length(v_email) not between 3 and 320 or position('@' in v_email)=0 then
    raise exception 'A valid billing email is required' using errcode='22023';
  end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=p_actor_user_id;
  if v_role is distinct from 'owner' then
    raise exception 'Only the business Owner can start installment billing' using errcode='42501';
  end if;

  select sch.* into strict v_schedule
  from public.sellertray_commercial_installment_schedule sch
  where sch.tenant_id=p_tenant_id and sch.id=p_installment_schedule_id;
  select o.* into strict v_obligation
  from public.sellertray_commercial_installment_obligations o
  where o.tenant_id=p_tenant_id and o.id=v_schedule.installment_obligation_id;
  select o.* into strict v_order
  from public.sellertray_commercial_orders o
  where o.tenant_id=p_tenant_id and o.id=v_obligation.commercial_order_id;
  select s.plan_code into strict v_plan_code
  from public.sellertray_commercial_order_price_snapshots s
  where s.tenant_id=p_tenant_id and s.commercial_order_id=v_order.id and s.line_type='subscription';

  perform public.lock_sellertray_commercial_order(p_tenant_id,v_order.id);
  perform public.supersede_sellertray_stale_installment_checkouts(p_tenant_id,v_order.id);
  v_state := public.get_sellertray_commercial_settlement_state(p_tenant_id,v_order.id);
  v_next_schedule_id := nullif(v_state->>'nextInstallmentScheduleId','')::uuid;
  v_next_amount := coalesce((v_state->>'nextPayableAmount')::numeric,0);

  if coalesce((v_state->>'outstandingAmount')::numeric,0)<0.005 then
    return jsonb_build_object(
      'status','paid','installmentScheduleId',p_installment_schedule_id,
      'amount',0,'currency',v_obligation.currency,'planCode',v_plan_code,
      'needsProviderInitialization',false
    );
  end if;

  select s.* into v_existing
  from public.billing_checkout_sessions s
  where s.tenant_id=p_tenant_id and s.checkout_kind='installment' and s.command_id=p_command_id;
  if found then
    if v_existing.installment_schedule_id<>v_schedule.id
       or v_existing.requested_by_user_id<>p_actor_user_id
       or lower(v_existing.billing_email)<>v_email then
      raise exception 'Installment checkout command is already used for different facts'
        using errcode='23505';
    end if;
    return jsonb_build_object(
      'sessionId',v_existing.id,'status',v_existing.status,'reference',v_existing.reference,
      'authorizationUrl',v_existing.authorization_url,
      'installmentScheduleId',v_existing.installment_schedule_id,'amount',v_existing.amount,
      'currency',v_existing.currency,'planCode',v_existing.plan_code,
      'needsProviderInitialization',v_existing.status='preparing' and v_existing.authorization_url is null
    );
  end if;

  if v_next_schedule_id is distinct from p_installment_schedule_id then
    raise exception 'Selected installment is not the current authoritative payable schedule'
      using errcode='23514';
  end if;

  select s.* into v_existing
  from public.billing_checkout_sessions s
  where s.tenant_id=p_tenant_id and s.checkout_kind='installment'
    and s.installment_schedule_id=v_schedule.id
    and s.status in ('preparing','initialized','paid')
  order by s.created_at desc
  limit 1;
  if found then
    return jsonb_build_object(
      'sessionId',v_existing.id,'status',v_existing.status,'reference',v_existing.reference,
      'authorizationUrl',v_existing.authorization_url,
      'installmentScheduleId',v_existing.installment_schedule_id,'amount',v_existing.amount,
      'currency',v_existing.currency,'planCode',v_existing.plan_code,
      'needsProviderInitialization',false
    );
  end if;

  v_reference := 'sti-'||substr(replace(p_tenant_id::text,'-',''),1,8)
    ||'-'||replace(p_command_id::text,'-','');

  insert into public.billing_checkout_sessions(
    tenant_id,plan_code,requested_by_user_id,billing_email,provider,reference,
    status,checkout_kind,command_id,commercial_order_id,installment_obligation_id,
    installment_schedule_id,amount,currency,created_at,updated_at
  ) values (
    p_tenant_id,v_plan_code,p_actor_user_id,v_email,'paystack',v_reference,
    'preparing','installment',p_command_id,v_order.id,v_obligation.id,
    v_schedule.id,v_next_amount,v_obligation.currency,now(),now()
  ) returning * into v_session;

  return jsonb_build_object(
    'sessionId',v_session.id,'status',v_session.status,'reference',v_session.reference,
    'authorizationUrl',v_session.authorization_url,
    'installmentScheduleId',v_session.installment_schedule_id,'amount',v_session.amount,
    'currency',v_session.currency,'planCode',v_session.plan_code,
    'needsProviderInitialization',true
  );
end;
$$;
revoke all on function public.reserve_sellertray_installment_checkout(uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.reserve_sellertray_installment_checkout(uuid,uuid,uuid,uuid,text) to service_role;

create or replace function public.guard_sellertray_initial_purchase_installment_checkout()
returns trigger
language plpgsql
set search_path=''
as $$
declare
  v_order public.sellertray_commercial_orders%rowtype;
  v_obligation public.sellertray_commercial_installment_obligations%rowtype;
  v_schedule public.sellertray_commercial_installment_schedule%rowtype;
  v_plan_code text;
  v_settlement jsonb;
  v_next_schedule_id uuid;
  v_next_amount numeric(18,2);
  v_expected_reference text;
begin
  if new.checkout_kind is distinct from 'installment' then
    return new;
  end if;

  if new.tenant_id is null or new.command_id is null or new.commercial_order_id is null
     or new.installment_obligation_id is null or new.installment_schedule_id is null
     or new.amount is null or new.currency is null then
    raise exception 'Installment checkout requires governed commercial order, obligation, schedule and money identity'
      using errcode='23514';
  end if;
  if new.provider<>'paystack' or new.status<>'preparing'
     or new.authorization_url is not null
     or new.provider_customer_ref is not null
     or new.provider_subscription_ref is not null then
    raise exception 'Installment checkout must begin as an uninitialized Paystack reservation'
      using errcode='23514';
  end if;
  if not exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id=new.tenant_id and tm.user_id=new.requested_by_user_id and tm.role='owner'
  ) then
    raise exception 'Only the business Owner can create an installment checkout reservation'
      using errcode='42501';
  end if;

  v_expected_reference := 'sti-'||substr(replace(new.tenant_id::text,'-',''),1,8)
    ||'-'||replace(new.command_id::text,'-','');
  if new.reference<>v_expected_reference then
    raise exception 'Installment checkout reference must match the governed command identity'
      using errcode='23514';
  end if;

  select o.* into strict v_order
  from public.sellertray_commercial_orders o
  where o.tenant_id=new.tenant_id and o.id=new.commercial_order_id;
  select o.* into strict v_obligation
  from public.sellertray_commercial_installment_obligations o
  where o.tenant_id=new.tenant_id and o.id=new.installment_obligation_id
    and o.commercial_order_id=v_order.id;
  select s.* into strict v_schedule
  from public.sellertray_commercial_installment_schedule s
  where s.tenant_id=new.tenant_id and s.id=new.installment_schedule_id
    and s.installment_obligation_id=v_obligation.id;
  select s.plan_code into strict v_plan_code
  from public.sellertray_commercial_order_price_snapshots s
  where s.tenant_id=new.tenant_id and s.commercial_order_id=v_order.id
    and s.line_type='subscription';

  v_settlement := public.get_sellertray_commercial_settlement_state(new.tenant_id,v_order.id);
  v_next_schedule_id := nullif(v_settlement->>'nextInstallmentScheduleId','')::uuid;
  v_next_amount := coalesce((v_settlement->>'nextPayableAmount')::numeric,0);

  if v_next_schedule_id is null or v_next_amount < 0.005 then
    raise exception 'Commercial order is already settled' using errcode='23514';
  end if;
  if new.installment_schedule_id<>v_next_schedule_id
     or new.plan_code is distinct from v_plan_code
     or new.currency is distinct from v_obligation.currency
     or abs(new.amount-v_next_amount)>=0.005 then
    raise exception 'Installment checkout must match the current authoritative payable schedule and amount'
      using errcode='23514';
  end if;

  return new;
end;
$$;
revoke all on function public.guard_sellertray_initial_purchase_installment_checkout() from public,anon,authenticated;
