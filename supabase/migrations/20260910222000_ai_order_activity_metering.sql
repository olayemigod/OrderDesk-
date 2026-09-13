alter table public.subscription_plans
  add column if not exists usage_event_code text not null default 'AI_ORDER_ACTIVITY',
  add column if not exists usage_unit_price numeric(14, 2);

alter table public.subscription_plans
  drop constraint if exists subscription_plans_usage_event_code_check,
  add constraint subscription_plans_usage_event_code_check
    check (usage_event_code = 'AI_ORDER_ACTIVITY'),
  drop constraint if exists subscription_plans_usage_unit_price_check,
  add constraint subscription_plans_usage_unit_price_check
    check (usage_unit_price is null or usage_unit_price >= 0);

create table if not exists public.usage_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  source_message_id uuid not null references public.inbound_messages(id) on delete cascade,
  event_code text not null,
  quantity integer not null default 1,
  unit_price numeric(14, 2),
  amount numeric(14, 2) generated always as (
    case when unit_price is null then null else quantity * unit_price end
  ) stored,
  occurred_at timestamptz not null default now(),
  constraint usage_events_event_code_check check (event_code = 'AI_ORDER_ACTIVITY'),
  constraint usage_events_quantity_check check (quantity > 0),
  constraint usage_events_unit_price_check check (unit_price is null or unit_price >= 0),
  unique (source_message_id, event_code)
);

create index if not exists usage_events_tenant_period_idx
  on public.usage_events (tenant_id, occurred_at desc);

alter table public.usage_events enable row level security;

revoke all on table public.usage_events from anon, authenticated;
grant select on table public.usage_events to authenticated;

drop policy if exists usage_events_select_member on public.usage_events;
create policy usage_events_select_member
on public.usage_events
for select
to authenticated
using (
  exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = usage_events.tenant_id
      and tm.user_id = (select auth.uid())
  )
);

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

  select p.usage_unit_price
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

drop trigger if exists orders_record_ai_usage on public.orders;
create trigger orders_record_ai_usage
after insert on public.orders
for each row
execute function public.record_orderdesk_ai_usage();

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
