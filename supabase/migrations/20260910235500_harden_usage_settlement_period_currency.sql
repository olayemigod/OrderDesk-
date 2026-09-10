alter table public.usage_events
  add column if not exists currency text;

update public.usage_events u
set currency = coalesce(p.currency, t.currency, 'NGN')
from public.tenants t
left join public.tenant_subscriptions s on s.tenant_id = t.id
left join public.subscription_plans p on p.code = s.plan_code
where u.tenant_id = t.id
  and u.currency is null;

alter table public.usage_events
  alter column currency set not null,
  drop constraint if exists usage_events_currency_check,
  add constraint usage_events_currency_check
    check (currency ~ '^[A-Z]{3}$');

create or replace function public.record_orderdesk_ai_usage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_currency text;
  v_unit_price numeric(14, 2);
  v_period_start timestamptz;
  v_period_end timestamptz;
begin
  if new.parser_source is distinct from 'external' or new.source_message_id is null then
    return new;
  end if;

  select
    s.status,
    coalesce(p.currency, t.currency, 'NGN'),
    p.usage_unit_price,
    s.current_period_start,
    s.current_period_end
  into
    v_status,
    v_currency,
    v_unit_price,
    v_period_start,
    v_period_end
  from public.tenant_subscriptions s
  join public.tenants t on t.id = s.tenant_id
  join public.subscription_plans p on p.code = s.plan_code
  where s.tenant_id = new.tenant_id;

  v_currency := coalesce(v_currency, 'NGN');

  if v_status not in ('active', 'grace')
    or v_unit_price is null
    or v_unit_price <= 0
    or v_period_start is null
    or v_period_end is null
    or v_period_end <= v_period_start
  then
    v_unit_price := null;
    v_period_start := null;
    v_period_end := null;
  end if;

  insert into public.usage_events (
    tenant_id,
    source_message_id,
    event_code,
    quantity,
    unit_price,
    currency,
    billing_period_start,
    billing_period_end
  ) values (
    new.tenant_id,
    new.source_message_id,
    'AI_ORDER_ACTIVITY',
    1,
    v_unit_price,
    v_currency,
    v_period_start,
    v_period_end
  )
  on conflict (source_message_id, event_code) do nothing;

  return new;
end;
$$;

revoke all on function public.record_orderdesk_ai_usage() from public, anon, authenticated;
grant execute on function public.record_orderdesk_ai_usage() to service_role;

create or replace function public.prepare_orderdesk_usage_settlement(
  p_tenant_id uuid,
  p_period_start timestamptz,
  p_period_end timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.usage_settlements%rowtype;
  v_currency text;
  v_currency_count integer;
  v_units integer;
  v_amount numeric(14, 2);
  v_settlement_id uuid;
  v_provider_reference text;
begin
  if p_period_start is null or p_period_end is null or p_period_end <= p_period_start then
    raise exception 'Invalid usage settlement period';
  end if;

  if p_period_end > now() then
    raise exception 'Usage settlement period must be closed';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_tenant_id::text || '|' || p_period_start::text || '|' || p_period_end::text,
      0
    )
  );

  select *
  into v_existing
  from public.usage_settlements
  where tenant_id = p_tenant_id
    and event_code = 'AI_ORDER_ACTIVITY'
    and period_start = p_period_start
    and period_end = p_period_end;

  if found then
    return jsonb_build_object(
      'id', v_existing.id,
      'status', v_existing.status,
      'units', v_existing.units,
      'amount', v_existing.amount,
      'currency', v_existing.currency,
      'providerReference', v_existing.provider_reference,
      'existing', true
    );
  end if;

  select
    count(distinct u.currency)::integer,
    min(u.currency),
    coalesce(sum(u.quantity), 0)::integer,
    coalesce(sum(u.amount), 0)::numeric(14, 2)
  into
    v_currency_count,
    v_currency,
    v_units,
    v_amount
  from public.usage_events u
  where u.tenant_id = p_tenant_id
    and u.event_code = 'AI_ORDER_ACTIVITY'
    and u.billing_period_start = p_period_start
    and u.billing_period_end = p_period_end
    and u.amount is not null
    and u.amount > 0
    and not exists (
      select 1
      from public.usage_settlement_items usi
      where usi.usage_event_id = u.id
    );

  if v_units <= 0 or v_amount <= 0 then
    select coalesce(p.currency, t.currency, 'NGN')
      into v_currency
    from public.tenants t
    left join public.tenant_subscriptions s on s.tenant_id = t.id
    left join public.subscription_plans p on p.code = s.plan_code
    where t.id = p_tenant_id;

    return jsonb_build_object(
      'status', 'empty',
      'units', 0,
      'amount', 0,
      'currency', coalesce(v_currency, 'NGN'),
      'existing', false
    );
  end if;

  if v_currency_count <> 1 or v_currency is null then
    raise exception 'Usage settlement period contains inconsistent currency snapshots';
  end if;

  v_settlement_id := gen_random_uuid();
  v_provider_reference := 'su-' || replace(v_settlement_id::text, '-', '');

  insert into public.usage_settlements (
    id,
    tenant_id,
    event_code,
    period_start,
    period_end,
    currency,
    units,
    amount,
    status,
    provider,
    provider_reference
  ) values (
    v_settlement_id,
    p_tenant_id,
    'AI_ORDER_ACTIVITY',
    p_period_start,
    p_period_end,
    v_currency,
    v_units,
    v_amount,
    'pending',
    'paystack',
    v_provider_reference
  );

  insert into public.usage_settlement_items (settlement_id, usage_event_id, amount)
  select v_settlement_id, u.id, u.amount
  from public.usage_events u
  where u.tenant_id = p_tenant_id
    and u.event_code = 'AI_ORDER_ACTIVITY'
    and u.billing_period_start = p_period_start
    and u.billing_period_end = p_period_end
    and u.currency = v_currency
    and u.amount is not null
    and u.amount > 0
    and not exists (
      select 1
      from public.usage_settlement_items usi
      where usi.usage_event_id = u.id
    );

  return jsonb_build_object(
    'id', v_settlement_id,
    'status', 'pending',
    'units', v_units,
    'amount', v_amount,
    'currency', v_currency,
    'providerReference', v_provider_reference,
    'existing', false
  );
end;
$$;

revoke all on function public.prepare_orderdesk_usage_settlement(uuid, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.prepare_orderdesk_usage_settlement(uuid, timestamptz, timestamptz)
  to service_role;
