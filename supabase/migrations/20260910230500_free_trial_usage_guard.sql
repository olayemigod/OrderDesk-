create or replace function public.record_orderdesk_ai_usage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_unit_price numeric(14, 2);
begin
  if new.parser_source is distinct from 'external' or new.source_message_id is null then
    return new;
  end if;

  select case
      when s.status in ('active', 'grace') then p.usage_unit_price
      else null
    end
    into v_unit_price
  from public.tenant_subscriptions s
  join public.subscription_plans p on p.code = s.plan_code
  where s.tenant_id = new.tenant_id;

  insert into public.usage_events (
    tenant_id,
    source_message_id,
    event_code,
    quantity,
    unit_price
  ) values (
    new.tenant_id,
    new.source_message_id,
    'AI_ORDER_ACTIVITY',
    1,
    v_unit_price
  )
  on conflict (source_message_id, event_code) do nothing;

  return new;
end;
$$;

revoke all on function public.record_orderdesk_ai_usage() from public, anon, authenticated;
grant execute on function public.record_orderdesk_ai_usage() to service_role;

create or replace function public.get_orderdesk_subscription_access(p_tenant_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'planCode', s.plan_code,
    'planName', p.name,
    'baseStatus', s.status,
    'effectiveStatus', case
      when s.status = 'trial' and s.trial_ends_at is not null and s.trial_ends_at <= now() then 'trial_expired'
      when s.status = 'grace' and s.grace_ends_at is not null and s.grace_ends_at <= now() then 'grace_expired'
      else s.status
    end,
    'accessMode', case
      when s.status = 'active' then 'full'
      when s.status = 'trial' and (s.trial_ends_at is null or s.trial_ends_at > now()) then 'full'
      when s.status = 'grace' and (s.grace_ends_at is null or s.grace_ends_at > now()) then 'full'
      else 'read_only'
    end,
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
      s.status in ('active', 'grace')
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
