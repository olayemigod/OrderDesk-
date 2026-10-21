begin;

-- C1B runtime compatibility and read authority.
--
-- tenant_subscriptions remains the runtime access source until C2, but a C1B
-- provisional/full entitlement has a governed end time that must actually
-- expire. Legacy active subscriptions keep their existing semantics.

create or replace function public.sellertray_c1b_runtime_period_state(
  p_tenant_id uuid
)
returns text
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_auth_role text := coalesce((select auth.role()),'');
  v_subscription public.tenant_subscriptions%rowtype;
  v_event public.sellertray_commercial_entitlement_events%rowtype;
begin
  if p_tenant_id is null then
    return null;
  end if;

  if v_auth_role<>'service_role' then
    if v_user_id is null or not exists (
      select 1 from public.tenant_members tm
      where tm.tenant_id=p_tenant_id and tm.user_id=v_user_id
    ) then
      return null;
    end if;
  end if;

  select s.* into v_subscription
  from public.tenant_subscriptions s
  where s.tenant_id=p_tenant_id;

  if not found
     or v_subscription.current_period_start is null
     or v_subscription.current_period_end is null then
    return 'legacy';
  end if;

  select e.* into v_event
  from public.sellertray_commercial_entitlement_events e
  where e.tenant_id=p_tenant_id
    and e.effective_from=v_subscription.current_period_start
    and e.effective_until=v_subscription.current_period_end
    and e.event_type in (
      'installment.provisional_activated',
      'installment.full_entitlement_released'
    )
  order by case e.event_type
    when 'installment.full_entitlement_released' then 0
    else 1
  end,e.recorded_at desc
  limit 1;

  if not found then
    return 'legacy';
  end if;

  if v_event.effective_until<=now() then
    return case
      when v_event.event_type='installment.provisional_activated' then 'provisional_expired'
      else 'full_term_expired'
    end;
  end if;

  return case
    when v_event.event_type='installment.provisional_activated' then 'provisional'
    else 'full_term'
  end;
end;
$$;

revoke all on function public.sellertray_c1b_runtime_period_state(uuid)
  from public,anon;
grant execute on function public.sellertray_c1b_runtime_period_state(uuid)
  to authenticated,service_role;

create or replace function public.orderdesk_subscription_can_write(p_tenant_id uuid)
returns boolean
language sql
stable
set search_path=''
as $$
  select coalesce(
    (
      select case
        when public.sellertray_c1b_runtime_period_state(s.tenant_id) in (
          'provisional_expired','full_term_expired'
        ) then false
        when s.status = 'active' then true
        when s.status = 'trial' then s.trial_ends_at is null or s.trial_ends_at > now()
        when s.status = 'grace' then s.grace_ends_at is null or s.grace_ends_at > now()
        else false
      end
      from public.tenant_subscriptions s
      where s.tenant_id = p_tenant_id
    ),
    false
  );
$$;

create or replace function public.get_orderdesk_subscription_access(p_tenant_id uuid)
returns jsonb
language sql
stable
set search_path=''
as $$
  select jsonb_build_object(
    'planCode', s.plan_code,
    'planName', p.name,
    'baseStatus', s.status,
    'effectiveStatus', case
      when public.sellertray_c1b_runtime_period_state(s.tenant_id)='provisional_expired' then 'past_due'
      when public.sellertray_c1b_runtime_period_state(s.tenant_id)='full_term_expired' then 'past_due'
      when s.status = 'trial' and s.trial_ends_at is not null and s.trial_ends_at <= now() then 'trial_expired'
      when s.status = 'grace' and s.grace_ends_at is not null and s.grace_ends_at <= now() then 'grace_expired'
      else s.status
    end,
    'accessMode', case
      when public.sellertray_c1b_runtime_period_state(s.tenant_id) in (
        'provisional_expired','full_term_expired'
      ) then 'read_only'
      when s.status = 'active' then 'full'
      when s.status = 'trial' and (s.trial_ends_at is null or s.trial_ends_at > now()) then 'full'
      when s.status = 'grace' and (s.grace_ends_at is null or s.grace_ends_at > now()) then 'full'
      else 'read_only'
    end,
    'commercialEntitlementState', public.sellertray_c1b_runtime_period_state(s.tenant_id),
    'trialStartedAt', s.trial_started_at,
    'trialEndsAt', s.trial_ends_at,
    'currentPeriodStart', s.current_period_start,
    'currentPeriodEnd', s.current_period_end,
    'graceEndsAt', s.grace_ends_at,
    'cancelAtPeriodEnd', s.cancel_at_period_end,
    'currency', p.currency,
    'priceAmount', p.price_amount,
    'billingInterval', p.billing_interval,
    'checkoutReady', (
      p.is_active = true
      and p.provider = 'paystack'
      and p.provider_plan_ref is not null
      and p.price_amount is not null
      and p.price_amount > 0
    ),
    'usageEventCode', p.usage_event_code,
    'usageUnitPrice', p.usage_unit_price,
    'usagePricingActive', (p.usage_unit_price is not null and p.usage_unit_price > 0),
    'usageBillableNow', (
      public.orderdesk_subscription_can_write(s.tenant_id)
      and s.status in ('active', 'grace')
      and p.usage_unit_price is not null
      and p.usage_unit_price > 0
    ),
    'usageUnitsThisPeriod', coalesce((
      select sum(u.quantity)
      from public.usage_events u
      where u.tenant_id = s.tenant_id
        and u.event_code = p.usage_event_code
        and u.occurred_at >= coalesce(s.current_period_start, s.trial_started_at, date_trunc('month', now()))
        and u.occurred_at < coalesce(s.current_period_end, s.trial_ends_at, date_trunc('month', now()) + interval '1 month')
    ), 0),
    'usageAmountThisPeriod', coalesce((
      select sum(u.amount)
      from public.usage_events u
      where u.tenant_id = s.tenant_id
        and u.event_code = p.usage_event_code
        and u.occurred_at >= coalesce(s.current_period_start, s.trial_started_at, date_trunc('month', now()))
        and u.occurred_at < coalesce(s.current_period_end, s.trial_ends_at, date_trunc('month', now()) + interval '1 month')
    ), 0)
  )
  from public.tenant_subscriptions s
  join public.subscription_plans p on p.code = s.plan_code
  where s.tenant_id = p_tenant_id;
$$;

create or replace function public.get_sellertray_installment_billing_states_for_tenant(
  p_tenant_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
stable
security invoker
set search_path=''
as $$
declare
  v_role text;
  v_result jsonb;
begin
  if p_tenant_id is null or p_actor_user_id is null then
    raise exception 'Business and user are required' using errcode='22023';
  end if;

  select tm.role into v_role
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.user_id=p_actor_user_id;
  if v_role not in ('owner','manager') then
    raise exception 'Installment billing access requires an Owner or Manager' using errcode='42501';
  end if;

  select coalesce(jsonb_agg(
    public.get_sellertray_installment_billing_state(p_tenant_id,o.id)
    order by o.created_at,o.id
  ),'[]'::jsonb)
  into v_result
  from public.sellertray_commercial_installment_obligations o
  where o.tenant_id=p_tenant_id;

  return v_result;
end;
$$;

revoke all on function public.get_sellertray_installment_billing_states_for_tenant(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.get_sellertray_installment_billing_states_for_tenant(uuid,uuid)
  to service_role;

create or replace function public.get_sellertray_installment_billing_states_for_admin(
  p_tenant_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
stable
security invoker
set search_path=''
as $$
declare
  v_role text;
  v_result jsonb;
begin
  if p_tenant_id is null or p_actor_user_id is null then
    raise exception 'Business and administrator are required' using errcode='22023';
  end if;

  select pa.role into v_role
  from public.platform_admins pa
  where pa.user_id=p_actor_user_id;
  if v_role not in ('admin','support') then
    raise exception 'Platform administrator access required' using errcode='42501';
  end if;

  select coalesce(jsonb_agg(
    public.get_sellertray_installment_billing_state(p_tenant_id,o.id)
    order by o.created_at,o.id
  ),'[]'::jsonb)
  into v_result
  from public.sellertray_commercial_installment_obligations o
  where o.tenant_id=p_tenant_id;

  return v_result;
end;
$$;

revoke all on function public.get_sellertray_installment_billing_states_for_admin(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.get_sellertray_installment_billing_states_for_admin(uuid,uuid)
  to service_role;

commit;
